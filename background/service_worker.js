// background/service_worker.js
import { 
  openDB, addLecture, getLecture, addChunk, getChunk, updateChunk, updateLecture, 
  getIncompleteLectures, getPendingChunks, getFullTranscript
} from '../lib/db.js';

import { 
  transcribeChunk as transcribeAudio, 
  processTranscriptChunk, genCoreNotes, genUPSCQs
} from '../lib/ai_service.js';

let offscreenReady = false;
let pendingStart = null;
let isDraining = false;

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

// --- STATELESS RESILIENCE ENGINE ---
// Persistent keep-alive to prevent Service Worker from falling asleep during long lectures
let keepAliveInterval = null;
function startKeepAlive() {
    if (keepAliveInterval) return;
    keepAliveInterval = setInterval(async () => {
        try {
            await chrome.storage.local.get(['isRecording']);
            console.log("[Worker] Heartbeat: Persistence Active.");
        } catch (e) {}
    }, 20000);
}

// Resilient startup check - Moved inside a function to handle potential context issues
async function initializeWorker() {
    try {
        console.log("[Worker] Initializing Resilience Engine...");
        startKeepAlive();
        const incomplete = await getIncompleteLectures();
        for (const lecture of incomplete) {
            console.log(`[Worker] Resuming incomplete lecture: ${lecture.id}`);
            waitForTranscriptionComplete(lecture.id);
        }
    } catch (e) {
        console.error("[Worker] Initialization failed:", e);
    }
}

// Global error handler to prevent total crash
self.addEventListener('error', (event) => {
    console.error("[Worker] UNCAUGHT ERROR:", event.error);
    // Try to recover if it's a transient issue
    if (event.error && !event.error.message.includes('keepAliveInterval')) {
        initializeWorker();
    }
});

initializeWorker();

async function drainTranscriptionQueue() {
  startKeepAlive();
  if (isDraining) return;
  isDraining = true;
  console.log("[Worker] Draining transcription queue...");
  try {
    const incomplete = await getIncompleteLectures();
    if (incomplete.length === 0) console.log("[Worker] No incomplete lectures found.");
    for (const lecture of incomplete) {
       const pending = await getPendingChunks(lecture.id);
       if (pending.length > 0) console.log(`[Worker] Found ${pending.length} pending chunks for lecture ${lecture.id}`);
       
       // Parallel processing for performance
       await Promise.all(pending.map(async (chunk) => {
          if (chunk.retries >= 3) {
             console.error(`[Worker] Max retries reached for chunk ${chunk.chunkId}.`);
             await updateChunk(lecture.id, chunk.chunkId, { transcript: "[TRANSCRIPTION_ERROR]" });
             return;
          }
          try {
             console.log(`[Worker] Transcribing chunk ${chunk.chunkId} (Mode: ${lecture.mode})...`);
             const transcript = await transcribeAudio(chunk.audioBase64, lecture.mode);
             console.log(`[Worker] Transcription success for chunk ${chunk.chunkId}: ${transcript.substring(0, 30)}...`);
             await updateChunk(lecture.id, chunk.chunkId, { 
                transcript: transcript || "[SILENT_AUDIO]",
                retries: (chunk.retries || 0) + 1 
             });
          } catch (e) {
             console.error(`[Worker] Transcription error for chunk ${chunk.chunkId}:`, e);
             const errorMessage = e.message || "Unknown Transcription Error";
             
             // Check for critical API errors
             if (errorMessage.includes("401") || errorMessage.includes("403")) {
                 console.error("[Worker] Critical API error detected. Stopping session.");
                 await updateLecture(lecture.id, { status: 'error', error_message: "Invalid API Key. Please check settings." });
                 await chrome.storage.local.set({ isRecording: false, isSynthesizing: false, last_error: "API KEY ERROR: Check your Deepgram Key." });
                 return; // Exit loop
             }
             
             await updateChunk(lecture.id, chunk.chunkId, { retries: (chunk.retries || 0) + 1 });
          }
       }));
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
    console.log(`[Worker] Received saveChunk for lecture ${msg.lectureId}, chunk ${msg.chunkId}`);
    // Use a queue or direct call to avoid potential race conditions during high-frequency saves
    const saveToDB = async () => {
        try {
            await addChunk({ 
                lectureId: msg.lectureId, 
                chunkId: msg.chunkId, 
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
        console.log(`[Worker] START SESSION: Lecture ${msg.lectureId} (Mode: ${msg.mode})`);
        // --- START PROTOCOL ---
        const newLecture = {
            id: msg.lectureId,
            status: 'incomplete',
            mode: msg.mode || 'exam', // Use passed mode
            speed: msg.speed || 1.0, // Store speed for recorder reference
            createdAt: Date.now(),
            chunks: []
        };
        addLecture(newLecture).then(() => {
            console.log(`[Worker] Created lecture record: ${msg.lectureId}`);
        }).catch(e => console.error("[Worker] DB Error creating lecture:", e));

        if (offscreenReady) {
            chrome.runtime.sendMessage({ type: 'start', streamId: msg.streamId, lectureId: msg.lectureId, speed: msg.speed });
            sendResponse({ status: 'started' });
            return false;
        } else {
            console.log("[Worker] Offscreen not ready, pending start...");
            pendingStart = { streamId: msg.streamId, lectureId: msg.lectureId, speed: msg.speed, callback: sendResponse };
            ensureOffscreenDocument();
            return true; // We WILL call sendResponse asynchronously when offscreen_ready fires
        }
    } else if (msg.action === 'stop') {
        console.log(`[Worker] STOP SESSION: Lecture ${msg.lectureId}`);
        chrome.runtime.sendMessage({ type: 'stop' });
        waitForTranscriptionComplete(msg.lectureId);
        sendResponse({ status: 'stopped' });
        return false;
    }
  }
  return false;
});

async function waitForTranscriptionComplete(lectureId) {
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
        const range = IDBKeyRange.only(lectureId);
        const allChunks = await new Promise(r => {
            const req = index.getAll(range);
            req.onsuccess = () => r(req.result);
        });

        const pending = allChunks.filter(c => !c.transcript);
        
        console.log(`[Worker] Polling status: ${allChunks.length} chunks total, ${pending.length} pending.`);

        if (allChunks.length > 0 && pending.length === 0) {
            const fullTranscript = await getFullTranscript(lectureId);
            if (fullTranscript.length > 50) {
                console.log(`[Worker] Transcription complete (${fullTranscript.length} chars). Starting AI Synthesis.`);
                await updateLecture(lectureId, { status: 'synthesizing' });
                startUPSCThinkingEngine(lectureId);
            } else if (attempts < 60) {
                console.log("[Worker] Transcript too short, waiting for more data...");
                attempts++;
                setTimeout(poll, 2000);
            } else {
                console.warn("[Worker] Session too short after 120s of polling.");
                await updateLecture(lectureId, { status: 'error', error_message: "Session too short." });
                await chrome.storage.local.set({ isSynthesizing: false, last_error: "Session too short. Ensure you recorded for at least 30-60s." });
            }
        } else if (attempts < maxAttempts) {
            attempts++;
            drainTranscriptionQueue();
            setTimeout(poll, 2000);
        } else {
            console.error("[Worker] Transcription timeout reached.");
            await updateLecture(lectureId, { status: 'error', error_message: "Transcription timeout." });
            await chrome.storage.local.set({ isSynthesizing: false, last_error: "Transcription timeout." });
        }
    };
    poll();
}

/**
 * --- THE UPSC THINKING ENGINE PIPELINE ---
 * 1. Windowing: Split transcript into 4m 50s blocks.
 * 2. Layer 1: Process each block with Groq.
 * 3. Layer 2: Merge into Master Data Schema.
 * 4. Derivation: Run 6 agents in parallel groups.
 */
async function startUPSCThinkingEngine(lectureId) {
    try {
        const fullTranscript = await getFullTranscript(lectureId);
        
        if (!fullTranscript || fullTranscript.length < 50) {
            throw new Error("Transcript too short for processing.");
        }

        // --- 1. SMART WINDOWING (15,000 characters) ---
        const windowSize = 15000; 
        const windows = [];
        for (let i = 0; i < fullTranscript.length; i += windowSize) {
            windows.push(fullTranscript.substring(i, i + windowSize));
        }

        // Clean up transcript before processing - remove error markers
        const cleanWindows = windows.map(w => w.replace(/\[TRANSCRIPTION_ERROR\]/g, "").trim()).filter(w => w.length > 20);
        
        if (cleanWindows.length === 0) {
            throw new Error("No valid academic content found in transcript.");
        }

        // --- 2. LAYER 1: PARALLEL KNOWLEDGE EXTRACTION (GROQ 8B) ---
        await chrome.storage.local.set({ progress_text: `Extracting Knowledge (0/${cleanWindows.length})...` });
        
        const chunkSchemas = [];
        const batchSize = 3;
        for (let i = 0; i < cleanWindows.length; i += batchSize) {
            const batch = cleanWindows.slice(i, i + batchSize);
            const batchResults = await Promise.all(batch.map(w => processTranscriptChunk(w)));
            chunkSchemas.push(...batchResults.filter(r => r && Object.keys(r).length > 0));
            await chrome.storage.local.set({ progress_text: `Extracting Knowledge (${Math.min(i + batchSize, cleanWindows.length)}/${cleanWindows.length})...` });
        }

        if (chunkSchemas.length === 0) {
            throw new Error("Failed to extract structured knowledge from transcript.");
        }

        // --- 3. LAYER 2: MASTER SYNTHESIS (DUAL-CORE) ---
        let agentsFinished = 0;
        let tabOpened = false;
        await chrome.storage.local.set({ progress_text: "Synthesizing Insights (0/2)..." });

        const checkUnlock = async () => {
            agentsFinished++;
            await chrome.storage.local.set({ progress_text: `Synthesizing Insights (${agentsFinished}/2)...` });
            if (agentsFinished >= 1 && !tabOpened) {
                tabOpened = true;
                chrome.tabs.create({ url: chrome.runtime.getURL(`pages/transcript.html?id=${lectureId}`) });
            }
        };

        const tasks = [
            genCoreNotes(chunkSchemas).then(async d => {
                if (!d || !d.title) throw new Error("Synthesis produced empty notes.");
                await updateLecture(lectureId, { 
                    title: d.title, 
                    tags: d.tags,
                    summary_sheet: d.summary,
                    key_points: d.key_points,
                    glossary: d.glossary,
                    mindmap_data: d.mindmap_data
                });
                checkUnlock();
            }).catch(e => { 
                console.error("Core Notes failed:", e); 
                checkUnlock(); 
            }),

            genUPSCQs(chunkSchemas).then(async d => {
                if (!d || !d.mcqs) throw new Error("Synthesis produced no MCQs.");
                await updateLecture(lectureId, { 
                    mcqs: d.mcqs,
                    mains_questions: d.mains_questions
                });
                checkUnlock();
            }).catch(e => { 
                console.error("UPSC Engine failed:", e); 
                checkUnlock(); 
            })
        ];

        // Global timeout for synthesis tasks (5 minutes)
        const synthesisTimeout = new Promise((_, reject) => 
            setTimeout(() => reject(new Error("Synthesis Timeout (5m exceeded)")), 300000)
        );

        await Promise.race([Promise.allSettled(tasks), synthesisTimeout]);

        // Verify if we actually got data
        const lectureFinal = await getLecture(lectureId);
        if (!lectureFinal.title && !lectureFinal.mcqs) {
            throw new Error("AI Synthesis failed to produce any data. Check API keys and transcript quality.");
        }

        await updateLecture(lectureId, { status: 'complete' });
        await chrome.storage.local.set({ isSynthesizing: false, progress_text: null });
        
        if (!tabOpened) {
            chrome.tabs.create({ url: chrome.runtime.getURL(`pages/transcript.html?id=${lectureId}`) });
        }
    } catch (e) {
        console.error("UPSC Engine Pipeline Crashed:", e);
        await updateLecture(lectureId, { status: 'error', error_message: e.message });
        await chrome.storage.local.set({ isSynthesizing: false, last_error: "Engine Crash: " + e.message, progress_text: null });
    }
}
