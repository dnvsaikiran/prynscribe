import { 
  openDB, addLecture, getLecture, addChunk, getChunk, updateChunk, updateLecture, 
  getIncompleteLectures, getPendingChunks, getFullTranscript, addOutput, syncChunkToCloud
} from '/lib/db.js';

import { 
  transcribeChunk as transcribeAudio, 
  processTranscriptChunk, genSynthesisArtifact
} from '/lib/ai_service.js';
import { SynthesisEngine, calculateXP, calculateLevel, canUserUseMode, MODE_CONFIG } from '/lib/synthesis_engine.js';
import { translateTranscript, getDefaultOutputLanguage, getLangLabel } from '/lib/language_config.js';

let offscreenReady = false;
let pendingStart = null;
let isDraining = false;
let lastDrainTime = 0;

// --- EMERGENCY STARTUP PURGE ---
// This ensures that if the engine crashed previously, it doesn't "haunt" the next session
chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === 'install' || details.reason === 'update') {
        chrome.storage.local.set({ 
            isSynthesizing: false, 
            isRecording: false, 
            progress_text: null, 
            last_error: null,
            currentLectureId: null 
        });
    }
});

// --- EXTERNAL MESSAGE HANDLER (From Website) ---
chrome.runtime.onMessageExternal.addListener((msg, sender, sendResponse) => {
    console.log("[Worker] Received External Message from:", sender.url || sender.origin);
    
    if (msg.type === 'AUTH_SYNC') {
        const profile = msg.profile;
        console.log("[Worker] Syncing Auth Profile from Website:", profile?.email || "LOGOUT");
        
        if (profile) {
            chrome.storage.local.set({ 
                userProfile: profile,
                isPremium: profile.isPremium || false,
                userRegion: profile.region || 'GLOBAL',
                currentMode: profile.examPath || null,
                currentGoal: profile.goal || null
            }, () => {
                console.log("[Worker] Storage updated with profile.");
                sendResponse({ success: true, status: 'synced' });
            });
        } else {
            chrome.storage.local.remove(['userProfile', 'isPremium', 'userRegion', 'currentMode', 'currentGoal'], () => {
                console.log("[Worker] Profile cleared.");
                sendResponse({ success: true, status: 'cleared' });
            });
        }
    }
    return true; // Keep channel open for async sendResponse
});

// --- HEARTBEAT & PERSISTENCE ---
// Persistent keep-alive to prevent Service Worker from falling asleep during long lectures
var keepAliveInterval = null;

function startKeepAlive() {
    if (keepAliveInterval) return;
    // --- NUCLEAR HEARTBEAT (Every 15s) ---
    // Critical for 3-hour sessions to prevent Chrome from killing the worker
    keepAliveInterval = setInterval(async () => {
        const state = await chrome.storage.local.get(['isRecording', 'isSynthesizing']);
        if (state.isRecording || state.isSynthesizing) {
            console.log("[Worker] Heartbeat: Persistence Active.");
        }
    }, 15000);
}

// Resilient startup check - Moved inside a function to handle potential context issues
async function initializeWorker() {
    try {
        console.log("[Worker] Initializing Resilience Engine...");
        startKeepAlive();
        
        setTimeout(async () => {
            try {
                const incomplete = await getIncompleteLectures();
                for (const lecture of incomplete) {
                    console.log(`[Worker] Resuming incomplete lecture: ${lecture.id}`);
                    // Only start synthesis if it's NOT already in progress
                    // and wait for a manual 'stop' or if we are sure it's finished
                    // For now, let's just drain the queue.
                    drainTranscriptionQueue();
                }
            } catch (dbErr) {
                console.error("[Worker] DB Recovery Error:", dbErr);
            }
        }, 1000);
    } catch (e) {
        console.error("[Worker] Initialization failed:", e);
    }
}

// Global error handler to prevent total crash
self.addEventListener('error', (event) => {
    console.error("[Worker] UNCAUGHT ERROR:", event.error);
    // Recovery attempt is now safer
});

// Start initialization without blocking the registration of listeners
initializeWorker().catch(e => console.error("[Worker] Startup failure:", e));

async function drainTranscriptionQueue() {
  startKeepAlive();
  
  // --- WATCHDOG: If draining has been stuck for > 6 minutes, force reset ---
  if (isDraining && (Date.now() - lastDrainTime > 360000)) {
      console.warn("[Worker] Transcription queue appears stuck. Force resetting lock.");
      isDraining = false;
  }

  if (isDraining) return;
  isDraining = true;
  lastDrainTime = Date.now();
  console.log("[Worker] Draining transcription queue...");
  try {
    const incomplete = await getIncompleteLectures();
    console.log(`[Worker] Found ${incomplete.length} incomplete lectures`);
    for (const lecture of incomplete) {
       const pending = await getPendingChunks(lecture.id);
       console.log(`[Worker] Lecture ${lecture.id} has ${pending.length} pending chunks`);
       if (pending.length === 0) continue;

       // --- BATCHED SERIAL PROCESSING (MAX 2) ---
       // Reduced from 3 to 2 to improve stability on weak connections
       const BATCH_SIZE = 2;
       for (let i = 0; i < pending.length; i += BATCH_SIZE) {
           const batch = pending.slice(i, i + BATCH_SIZE);
           
           await chrome.storage.local.set({ 
               progress_text: `Step 1/3: Transcribing (${i + batch.length}/${pending.length})...` 
           });

           await Promise.all(batch.map(async (chunk) => {
               if (chunk.retries >= 5) { // Increased from 3 to 5
                   await updateChunk(lecture.id, chunk.chunkId, { transcript: "[TRANSCRIPTION_ERROR]" });
                   return;
               }
               try {
                   console.log(`[Worker] Transcribing chunk ${chunk.chunkId} (Attempt ${(chunk.retries || 0) + 1})...`);
                   const _tResult = await transcribeAudio(chunk.audioBase64, null);
                    const transcript = typeof _tResult === 'string' ? _tResult : (_tResult?.transcript || '');
                    const detectedLang = typeof _tResult === 'object' ? (_tResult?.detectedLang || 'en') : 'en';
                    // Store detected language for synthesis layer
                    const _ls = await chrome.storage.local.get(['detectedSourceLang']);
                    if (detectedLang !== _ls.detectedSourceLang) { await chrome.storage.local.set({ detectedSourceLang: detectedLang }); chrome.runtime.sendMessage({ type: 'language_detected', lang: detectedLang }).catch(()=>{}); }
                   await updateChunk(lecture.id, chunk.chunkId, { 
                       transcript: transcript || "[SILENCE]",
                       retries: (chunk.retries || 0) + 1 
                   });
                   
                   // --- PROACTIVE BROADCAST: Push to Popup for Live Scribe ---
                   console.log(`[Worker] Sending transcript_update for lecture ${lecture.id}: "${transcript.substring(0, 30)}..."`);
                    syncChunkToCloud(lecture.id, chunk.chunkId, transcript);
                   chrome.runtime.sendMessage({ 
                       type: 'transcript_update', 
                       lectureId: lecture.id, 
                       text: transcript 
                   }).catch(() => {});
               } catch (e) {
                   console.error(`[Worker] Chunk ${chunk.chunkId} failed:`, e.message);
                   await updateChunk(lecture.id, chunk.chunkId, { 
                       retries: (chunk.retries || 0) + 1,
                       last_error: e.message
                   });
               }
           }));
       }
    }
  } finally {
    isDraining = false;
  }
}

async function ensureOffscreenDocument() {
    const existing = await chrome.offscreen.hasDocument();
    if (!existing) {
        console.log("[Worker] Creating new offscreen document...");
        await chrome.offscreen.createDocument({
            url: chrome.runtime.getURL('offscreen/recorder.html'),
            reasons: ['USER_MEDIA', 'AUDIO_PLAYBACK'],
            justification: 'Capture session audio.'
        });
    } else {
        console.log("[Worker] Offscreen document already exists.");
        // If it exists but offscreenReady is false, it might be from a previous session
        // or the worker just restarted. Let's try to ping it.
        if (!offscreenReady) {
            try {
                const response = await chrome.runtime.sendMessage({ type: 'ping_offscreen' });
                if (response && response.status === 'pong') {
                    console.log("[Worker] Offscreen document responded to ping.");
                    offscreenReady = true;
                    if (pendingStart) {
                        chrome.runtime.sendMessage({ type: 'start', streamId: pendingStart.streamId, lectureId: pendingStart.lectureId });
                        if (pendingStart.callback) pendingStart.callback({ status: 'started' });
                        pendingStart = null;
                    }
                }
            } catch (e) {
                console.log("[Worker] Offscreen document exists but didn't respond. Recreating...");
                await chrome.offscreen.closeDocument();
                await chrome.offscreen.createDocument({
                    url: chrome.runtime.getURL('offscreen/recorder.html'),
                    reasons: ['USER_MEDIA', 'AUDIO_PLAYBACK'],
                    justification: 'Capture session audio.'
                });
            }
        }
    }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'offscreen_ready') {
    offscreenReady = true;
    if (pendingStart) {
        chrome.runtime.sendMessage({ 
            type: 'start', 
            streamId: pendingStart.streamId, 
            lectureId: pendingStart.lectureId,
            speed: pendingStart.speed
        });
        if (pendingStart.callback) pendingStart.callback({ status: 'started' });
        pendingStart = null;
    }
    // We don't owe an asynchronous sendResponse to offscreen_ready
    return false;
  } else if (msg.type === 'saveChunk') {
    if (!msg.lectureId) {
        console.warn("[Worker] Received saveChunk with null lectureId. Ignoring.");
        return false;
    }
    console.log(`[Worker] Received saveChunk for lecture ${msg.lectureId}, chunk ${msg.chunkId}`);
    // Use a queue or direct call to avoid potential race conditions during high-frequency saves
    const saveToDB = async () => {
        try {
            await addChunk({ 
                lectureId: msg.lectureId.toString(), 
                chunkId: parseInt(msg.chunkId), 
                audioBase64: msg.audioBase64, 
                transcript: null, 
                retries: 0 
            });
            drainTranscriptionQueue();
        } catch (e) {
            console.error("[Worker] DB error saving chunk:", e.name, e.message);
            // Retry once after a small delay if it's a constraint error or temporary lock
            setTimeout(async () => {
                try {
                    await addChunk({ 
                        lectureId: msg.lectureId, 
                        chunkId: msg.chunkId, 
                        audioBase64: msg.audioBase64, 
                        transcript: null, 
                        retries: 0 
                    });
                    drainTranscriptionQueue();
                } catch (err) {
                    console.error("[Worker] DB Retry failed:", err.name, err.message);
                }
            }, 500);
        }
    };
    saveToDB();
    sendResponse({ status: 'saved' });
    return false;
  } else if (msg.type === 'debug_log') {
    console.log(`[Worker DEBUG] ${msg.message}`);
    return false;
  } else if (msg.type === 'keepAlive') {
    sendResponse({ status: 'alive' });
    return false;
  } else if (msg.type === 'control') {
    startKeepAlive();
    if (msg.action === 'prepare') {
        console.log("[Worker] Preparing offscreen...");
        ensureOffscreenDocument();
        sendResponse({ status: 'warmer' });
        return false;
    } else if (msg.action === 'start') {
        console.log(`[Worker] START SESSION: Lecture ${msg.lectureId} (Mode: ${msg.mode}) with StreamID ${msg.streamId}`);
        // --- START PROTOCOL ---
        const newLecture = {
            id: msg.lectureId,
            status: 'incomplete',
            mode: msg.mode || 'exam', 
            goal: msg.goal || 'Academic Excellence',
            region: msg.region || 'GLOBAL',
            speed: msg.speed || 1.0, 
            createdAt: Date.now(),
            chunks: []
        };
        addLecture(newLecture).then(() => {
            console.log(`[Worker] Created lecture record: ${msg.lectureId}`);
        }).catch(e => console.error("[Worker] DB Error creating lecture:", e));

        if (offscreenReady) {
            console.log("[Worker] Offscreen ready, sending start message.");
            chrome.runtime.sendMessage({ type: 'start', streamId: msg.streamId, lectureId: msg.lectureId, speed: msg.speed });
            sendResponse({ status: 'started' });
            return false;
        } else {
            console.log("[Worker] Offscreen not ready, pending start...");
            pendingStart = { streamId: msg.streamId, lectureId: msg.lectureId, speed: msg.speed, callback: sendResponse };
            ensureOffscreenDocument();
            return true; // We WILL call sendResponse asynchronously when offscreen_ready fires
        }
    } else if (msg.action === 'drain') {
        drainTranscriptionQueue();
        sendResponse({ status: 'draining' });
        return false;
    } else if (msg.action === 'stop') {
        const lectureId = msg.lectureId || pendingStart?.lectureId;
        console.log(`[Worker] STOP SESSION: Lecture ${lectureId}`);
        chrome.runtime.sendMessage({ type: 'stop' });
        if (lectureId) {
            waitForTranscriptionComplete(lectureId);
        } else {
            console.error("[Worker] Stop called but no active Lecture ID found.");
        }
        sendResponse({ status: 'stopped' });
        return false;
    }
  } else if (msg.type === 'signal_level') {
    // Forward to any open tabs (especially the dashboard)
    chrome.tabs.query({}, (tabs) => {
        tabs.forEach(tab => {
            // Only send to valid tabs to avoid overhead
            try {
                chrome.tabs.sendMessage(tab.id, { type: 'signal_level', level: msg.level }).catch(() => {});
            } catch(e) {}
        });
    });
    return false;
  } else if (msg.type === 'AUTH_SYNC') {
    console.log("[Worker] Received Auth Sync Profile:", msg.profile ? msg.profile.email : "LOGOUT");
    if (msg.profile) {
        chrome.storage.local.set({ userProfile: msg.profile });
    } else {
        chrome.storage.local.remove(['userProfile']);
    }
    return false;
  }
  return false;
});

async function waitForTranscriptionComplete(lectureId) {
    if (!lectureId) {
        console.error("[Worker] Cannot wait for transcript: lectureId is missing.");
        await chrome.storage.local.set({ isSynthesizing: false, last_error: "Engine Error: Missing Session ID" });
        return;
    }
    let attempts = 0;
    const maxAttempts = 120;
    await chrome.storage.local.set({ isSynthesizing: true });
    console.log(`[Worker] Waiting for transcription: Lecture ${lectureId}`);
    drainTranscriptionQueue();

    const poll = async () => {
        const db = await openDB();
        const tx = db.transaction('chunks', 'readonly');
        const store = tx.objectStore('chunks');
        const index = store.index('lectureId');
        
        // Final safety check
        if (!lectureId) return;
        const sanitizedId = lectureId.toString();
        const range = IDBKeyRange.only(sanitizedId);
        const allChunks = await new Promise(r => {
            const req = index.getAll(range);
            req.onsuccess = () => r(req.result);
        });

        const pending = allChunks.filter(c => !c.transcript);
        
        console.log(`[Worker] Polling status: ${allChunks.length} chunks total, ${pending.length} pending.`);

        // --- 90% BRAVE EXIT RULE ---
        // If we have been waiting more than 60 seconds (attempts > 30) AND 
        // less than 3 chunks are missing, proceed anyway.
        const shouldBraveExit = attempts > 30 && pending.length > 0 && pending.length < 3;

        if (allChunks.length > 0) {
            await chrome.storage.local.set({ 
                progress_text: `Processing fragments (${pending.length} left)...` 
            });
        }

        const fullTranscript = await getFullTranscript(lectureId);
        const transcriptLength = fullTranscript?.trim().length || 0;

        // --- SYNTHESIS DECISION ---
        if (allChunks.length > 0 && (pending.length === 0 || shouldBraveExit)) {
            console.log(`[Worker] All chunks accounted for (${allChunks.length}). Checking transcript quality...`);
            
            if (transcriptLength > 50) {
                console.log(`[Worker] Transcription complete (${transcriptLength} chars). Starting AI Synthesis.`);
                await updateLecture(lectureId, { status: 'synthesizing' });
                startNeuralSynthesisEngine(lectureId);
            } else {
                console.warn(`[Worker] Session ended with insufficient transcript (${transcriptLength} chars). Marking as too short.`);
                await updateLecture(lectureId, { status: 'error', error_message: "Session too short or no speech detected." });
            }
        } else {
            // Keep polling if we still have pending chunks or session is still active
            if (attempts < 120) { // Increased from 60 to 120 (4 minutes)
                attempts++;
                setTimeout(poll, 2000);
            } else {
                console.error("[Worker] Transcription polling timed out after 4 minutes.");
                await updateLecture(lectureId, { status: 'error', error_message: "Transcription timed out." });
            }
        }
    };
    poll();
}

/**
 * --- THE NEURAL SYNTHESIS ENGINE PIPELINE ---
 * 1. Context: Fetch User Exam Path & Goal.
 * 2. Layer 1: Build Knowledge Blocks.
 * 3. Layer 2: Synthesize Artifacts via path-specific Engine.
 */
async function startNeuralSynthesisEngine(lectureId) {
    try {
        const lecture = await getLecture(lectureId);
        if (!lecture) throw new Error("Lecture not found for synthesis");
        
        // --- 1. CONTEXT INITIALIZATION ---
        const userState = await chrome.storage.local.get(['userProfile', 'userOnboarding', 'outputLanguage', 'selectedMode', 'detectedSourceLang', 'preferredOutputLang']);
        const examPath = lecture.mode || userState.userOnboarding?.path || 'General';
        const goal = lecture.goal || userState.userOnboarding?.goal || 'Learning';
        const userTier = userState.userProfile?.tier || 'free';
        
        // v28 Safeguard: Abort if transcript is too sparse
        const rawTranscript = await getFullTranscript(lectureId);
        if (!rawTranscript || rawTranscript.length < 50) {
            console.warn("[Worker] Synthesis aborted: Transcript too sparse.");
            throw new Error("Learning Artifact was too sparse (under 50 chars). Please check your audio source.");
        }
  
        // --- 1B. LANGUAGE PIPELINE ---
        // Layer A: Source language (detected during transcription)
        const sourceLang = userState.detectedSourceLang || 'en';
        // Layer C: Target output language (user preference or default English)
        const outputLangCode = userState.preferredOutputLang || userState.outputLanguage || 'en';
        const outputLanguage = getLangLabel(outputLangCode) || 'English';
        
        // Layer C: Translate if source != output (pro/elite only, but always translate if different)
        let fullTranscript = rawTranscript;
        if (sourceLang !== outputLangCode && rawTranscript.length > 50) {
            await chrome.storage.local.set({ progress_text: `🌐 Translating ${getLangLabel(sourceLang)} → ${getLangLabel(outputLangCode)}...` });
            console.log(`[Worker] Translating transcript from ${sourceLang} to ${outputLangCode}...`);
            try {
                const keys = await chrome.storage.local.get(['groq_api_key']);
                const groqKey = keys.groq_api_key || "";
                fullTranscript = await translateTranscript(rawTranscript, sourceLang, outputLangCode, groqKey);
                console.log(`[Worker] ✓ Translation complete. ${rawTranscript.length} chars → ${fullTranscript.length} chars`);
            } catch(e) {
                console.warn('[Worker] Translation failed, using source:', e.message);
                fullTranscript = rawTranscript;
            }
        }

        const engine = new SynthesisEngine(examPath, goal, outputLanguage, userTier);
        
        // --- 2. MODE ROUTING ---
        // Resolve the synthesis mode: use saved selection, or auto-detect
        let synthesisMode = userState.selectedMode || lecture.mode || 'auto';
        
        // Tier enforcement: downgrade if user doesn't have access
        if (!canUserUseMode(synthesisMode, userTier)) {
            console.warn(`[Worker] User tier '${userTier}' cannot use '${synthesisMode}'. Falling back to 'summary'.`);
            synthesisMode = 'summary';
        }
        
        // Auto-mode: let the engine detect the best mode
        if (synthesisMode === 'auto') {
            synthesisMode = engine.detectMode(fullTranscript.substring(0, 500), examPath);
            console.log(`[Worker] 🤖 Auto-Mode selected: ${synthesisMode}`);
        }
        
        console.log(`[Worker] Synthesis Engine: ${examPath} | Mode: ${synthesisMode} | Lang: ${outputLanguage}`);

        // --- 3. SINGLE-PASS SYNTHESIS (New Elite Architecture) ---
        await chrome.storage.local.set({ progress_text: `⚡ Synthesizing [${(MODE_CONFIG[synthesisMode]?.label || synthesisMode).toUpperCase()}]...` });
        
        const artifact = await genSynthesisArtifact(fullTranscript, engine, synthesisMode);

        // --- 4. FINAL HANDOFF & SYNC ---
        // Map universal artifact schema → lecture store fields
        const finalUpdates = {
            status: 'complete',
            mode: synthesisMode,
            title: artifact.title || "Academic Session Analysis",
            tags: artifact.tags || [],
            summary: artifact.summary || "",
            summary_sheet: artifact.master_summary_sheet || artifact.rapid_summary || artifact.narrative_script || artifact.printable_one_pager || artifact.executive_summary || artifact.summary || "",
            key_points: artifact.key_points || artifact.revision_notes || artifact.follow_up_tasks || [],
            glossary: artifact.glossary || [],
            mcqs: artifact.mcqs || [],
            flashcards: artifact.flashcards || artifact.spaced_repetition || [],
            // Mode-specific rich fields stored as raw JSON
            artifact_data: artifact
        };

        await updateLecture(lectureId, finalUpdates);
        
        const lectureFinal = await getLecture(lectureId);
        await chrome.storage.local.set({ progress_text: "☁️ Syncing to Cloud..." });
        
        // --- NUCLEAR VALIDATION ---
        if (!finalUpdates.summary_sheet || finalUpdates.summary_sheet.length < 30) {
            console.error("[Worker] Synthesis Validation Failed: Summary is missing or too short.");
            throw new Error("Learning Artifact was too sparse. Please check audio quality and retry.");
        }
        
        await addOutput(lectureId.toString(), lectureFinal);
        
        // --- 5. XP AWARD ---
        try {
            const storedXP = await chrome.storage.local.get(['xp', 'level', 'streak_days']);
            const currentXP = storedXP.xp || 0;
            const streakDays = storedXP.streak_days || 0;
            const earnedXP = calculateXP(fullTranscript.length, streakDays);
            const newTotalXP = currentXP + earnedXP;
            const newLevel = calculateLevel(newTotalXP);
            await chrome.storage.local.set({ xp: newTotalXP, level: newLevel });
            console.log(`[Worker] 🏆 +${earnedXP} XP earned! Total: ${newTotalXP} (Level ${newLevel})`);
            chrome.runtime.sendMessage({ type: 'xp_update', earned: earnedXP, total: newTotalXP, level: newLevel }).catch(() => {});
        } catch (e) { console.warn("[Worker] XP award failed:", e.message); }
        
        await chrome.storage.local.set({ isSynthesizing: false, progress_text: null, currentLectureId: null });
        
        // --- PROACTIVE NOTIFICATION ---
        chrome.runtime.sendMessage({ type: 'synthesis_complete', lectureId: lectureId, mode: synthesisMode }).catch(() => {});
        
        
    } catch (e) {
        console.error("UPSC Engine Pipeline Crashed:", e);
        await updateLecture(lectureId, { status: 'error', error_message: e.message });
        await chrome.storage.local.set({ isSynthesizing: false, last_error: "Engine Crash: " + e.message, progress_text: null });
        
        // FAIL-SAFE HANDOFF
        chrome.tabs.create({ url: chrome.runtime.getURL(`pages/transcript.html?id=${lectureId}`) });
    } finally {
        // Absolute safety reset
        await chrome.storage.local.set({ isSynthesizing: false, progress_text: null });
    }
}

