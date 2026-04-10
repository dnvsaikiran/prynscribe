// popup/popup.js
// Handles UI orchestration for the PrynScribe Pro "Zinc" Dashboard.

import { getFullTranscript, getLecture } from '../lib/db.js';
import { auth, googleProvider, signInWithPopup, signOut, onAuthStateChanged } from '../lib/firebase_config.js';

let isRecording = false;
let isSynthesizing = false;
let timerInterval = null;
let telemetryInterval = null;

document.addEventListener('DOMContentLoaded', async () => {
    const actionBtn = document.getElementById('actionBtn');
    const actionBtnText = actionBtn.querySelector('span');
    const statusLabel = document.getElementById('status-label');
    const waveViz = document.getElementById('wave-viz');
    const speedSlider = document.getElementById('speed-slider');
    const speedIndicator = document.getElementById('speed-indicator');
    const volumeSlider = document.getElementById('volume-slider');
    const volumeIndicator = document.getElementById('volume-indicator');
    const viewLibrary = document.getElementById('view-library');
    const settingsBtn = document.getElementById('settings-btn');
    const settingsPanel = document.getElementById('settings-panel');
    const saveSettings = document.getElementById('save-settings');
    const accountBtn = document.getElementById('account-btn');
    const accountPanel = document.getElementById('account-panel');
    const loginBtn = document.getElementById('login-btn');
    const planType = document.getElementById('plan-type');

    // Firebase Auth State Listener
    onAuthStateChanged(auth, (user) => {
        if (user) {
            loginBtn.textContent = 'LOGOUT';
            planType.textContent = 'PRO USER'; // You can link this to actual Firestore data later
            document.getElementById('usage-stats').textContent = `Logged in as: ${user.email}`;
        } else {
            loginBtn.textContent = 'LOGIN WITH GOOGLE';
            planType.textContent = 'FREE TIER';
            document.getElementById('usage-stats').textContent = '45 / 100 Transcription Minutes';
        }
    });

    loginBtn.addEventListener('click', async () => {
        if (auth.currentUser) {
            await signOut(auth);
        } else {
            try {
                statusLabel.textContent = "AUTHENTICATING...";
                await signInWithPopup(auth, googleProvider);
                statusLabel.textContent = "SYSTEM CONNECTED";
            } catch (error) {
                console.error("Auth Error:", error);
                statusLabel.textContent = "AUTH FAILED";
            }
        }
    });
    const state = await chrome.storage.local.get([
        'isRecording', 
        'isSynthesizing',
        'currentSpeed', 
        'currentVolume',
        'recordingStartTime',
        'deepgram_api_key',
        'groq_api_key',
        'gemini_api_key'
    ]);

    // Populate keys in settings
    if (state.deepgram_api_key) document.getElementById('deepgram-key').value = state.deepgram_api_key;
    if (state.groq_api_key) document.getElementById('groq-key').value = state.groq_api_key;
    if (state.gemini_api_key) document.getElementById('gemini-key').value = state.gemini_api_key;

    isRecording = state.isRecording || false;
    isSynthesizing = state.isSynthesizing || false;

    if (state.currentSpeed) {
        speedSlider.value = state.currentSpeed;
        speedIndicator.textContent = `${parseFloat(state.currentSpeed).toFixed(1)}x`;
    }
    if (state.currentVolume !== undefined) {
        volumeSlider.value = state.currentVolume;
        volumeIndicator.textContent = `${state.currentVolume}%`;
    }

    // Helper to send messages with automatic "Hot Injection"
    const sendTabMessage = async (msg) => {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab || !tab.url || tab.url.startsWith('chrome://')) return;
        try {
            await chrome.tabs.sendMessage(tab.id, msg);
        } catch (e) {
            try {
                await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, files: ['content/script.js'] });
                await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, files: ['content/inject.js'], world: 'MAIN' });
                setTimeout(() => chrome.tabs.sendMessage(tab.id, msg).catch(() => {}), 200);
            } catch (err) {}
        }
    };

    updateUI(isRecording, isSynthesizing);

    if (isRecording && state.recordingStartTime) {
        startTimer(state.recordingStartTime);
    } else if (!isSynthesizing) {
        try {
            chrome.runtime.sendMessage({ type: 'control', action: 'prepare' }).catch(() => {});
            sendTabMessage({ type: 'ping' });
        } catch (e) {}
    }

    // Listen for storage changes (to detect when synthesis finishes while popup is open)
    chrome.storage.onChanged.addListener((changes) => {
        if (changes.isSynthesizing) {
            isSynthesizing = changes.isSynthesizing.newValue;
            updateUI(isRecording, isSynthesizing);
        }
        if (changes.progress_text || changes.last_error) {
            updateUI(isRecording, isSynthesizing);
        }
    });

    speedSlider.addEventListener('input', (e) => {
        const speed = e.target.value;
        speedIndicator.textContent = `${parseFloat(speed).toFixed(1)}x`;
        chrome.storage.local.set({ currentSpeed: speed });
        sendTabMessage({ type: 'setSpeed', speed: parseFloat(speed) });
    });

    volumeSlider.addEventListener('input', (e) => {
        const volume = e.target.value;
        volumeIndicator.textContent = `${volume}%`;
        chrome.storage.local.set({ currentVolume: volume });
        sendTabMessage({ type: 'setVolume', volume: parseInt(volume) });
    });

    actionBtn.addEventListener('click', async () => {
        if (isSynthesizing) return; // Prevent multiple starts
        
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab || !tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('edge://')) {
            statusLabel.textContent = "RESTRICTED PAGE";
            statusLabel.style.color = '#f87171';
            return;
        }

        if (!isRecording) {
            // IMMEDIATE Capture call to preserve user gesture
            chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id }, async (streamId) => {
                if (chrome.runtime.lastError || !streamId) {
                    const err = chrome.runtime.lastError?.message || "Capture Denied";
                    console.error("[Popup] Tab Capture Error:", err);
                    statusLabel.textContent = "CAPTURE DENIED";
                    statusLabel.style.color = '#f87171';
                    return;
                }
                startFlow(tab, streamId);
            });
        } else {
            stopFlow();
        }
    });

    async function startFlow(tab, streamId) {
        if (!chrome.runtime?.id) {
           statusLabel.textContent = "REFRESH TAB";
           return;
        }

        const keys = await chrome.storage.local.get(['deepgram_api_key', 'groq_api_key']);
        if (!keys.deepgram_api_key && !keys.groq_api_key) {
           statusLabel.textContent = "KEY REQUIRED";
           settingsPanel.style.display = 'block';
           return;
        }

        const lectureId = Date.now();
        const startTime = Date.now();
        const mode = document.getElementById('notesStyle').value;
        const currentSpeed = parseFloat(speedSlider.value) || 1.0;

        // Clear old errors and set new session
        await chrome.storage.local.set({ 
            isRecording: true, 
            recordingStartTime: startTime, 
            currentLectureId: lectureId,
            last_error: null,
            progress_text: null,
            sessionSpeed: currentSpeed // Store speed for recorder to use
        });

        isRecording = true;
        updateUI(true, false);
        startTimer(startTime);

        chrome.runtime.sendMessage({ 
            type: 'control', action: 'start', lectureId, streamId, mode, speed: currentSpeed 
        }, () => {
            chrome.tabs.sendMessage(tab.id, { type: 'control', action: 'start' });
        });
    }

    async function stopFlow() {
        isRecording = false;
        isSynthesizing = true;
        updateUI(false, true);
        stopTimer(false); // Pause but don't reset UI yet

        const current = await chrome.storage.local.get(['currentLectureId']);
        chrome.runtime.sendMessage({ type: 'control', action: 'stop', lectureId: current.currentLectureId }, () => {
            chrome.storage.local.set({ isRecording: false, recordingStartTime: null });
        });
    }

    settingsBtn.addEventListener('click', () => {
        settingsPanel.style.display = settingsPanel.style.display === 'none' ? 'block' : 'none';
        accountPanel.style.display = 'none';
    });

    accountBtn.addEventListener('click', () => {
        accountPanel.style.display = accountPanel.style.display === 'none' ? 'block' : 'none';
        settingsPanel.style.display = 'none';
    });

    viewLibrary.addEventListener('click', () => {
        chrome.tabs.create({ url: chrome.runtime.getURL('pages/library.html') });
    });

    saveSettings.addEventListener('click', async () => {
        const dKey = document.getElementById('deepgram-key').value.trim();
        const gKey = document.getElementById('groq-key').value.trim();
        const gemKey = document.getElementById('gemini-key').value.trim();

        await chrome.storage.local.set({ 
            deepgram_api_key: dKey, 
            groq_api_key: gKey,
            gemini_api_key: gemKey
        });

        saveSettings.textContent = "SYNCED";
        setTimeout(() => { 
            saveSettings.textContent = "SYNC KEY PROTOCOLS"; 
        }, 1000);
    });

    // --- AUTO-SAVE LOGIC FOR INDIVIDUAL KEYS ---
    const keysMap = {
        'deepgram-key': 'deepgram_api_key',
        'groq-key': 'groq_api_key',
        'gemini-key': 'gemini_api_key'
    };

    Object.entries(keysMap).forEach(([elementId, storageKey]) => {
        const input = document.getElementById(elementId);
        const status = document.getElementById(`${elementId}-status`);
        
        if (input) {
            input.addEventListener('input', async (e) => {
                const value = e.target.value.trim();
                await chrome.storage.local.set({ [storageKey]: value });
                
                if (status) {
                    status.style.opacity = '1';
                    setTimeout(() => { status.style.opacity = '0'; }, 1000);
                }
            });
        }
    });

    const panicBtn = document.getElementById('panic-btn');
    if (panicBtn) {
        panicBtn.addEventListener('click', async () => {
            const current = await chrome.storage.local.get(['currentLectureId']);
            if (current.currentLectureId) {
                // Set the current lecture to error in DB to stop polling
                try {
                    const { updateLecture } = await import('../lib/db.js');
                    await updateLecture(current.currentLectureId, { status: 'error', error_message: "User Terminated Session" });
                } catch (e) {}
            }

            await chrome.storage.local.set({ 
                isSynthesizing: false, 
                isRecording: false, 
                progress_text: null, 
                last_error: "SYSTEM HARD RESET COMPLETE",
                currentLectureId: null 
            });
            panicBtn.textContent = "SYSTEM RESET";
            setTimeout(() => location.reload(), 1000);
        });
    }
});

async function updateUI(recording, synthesizing) {
    const actionBtn = document.getElementById('actionBtn');
    const actionBtnText = actionBtn.querySelector('span');
    const statusLabel = document.getElementById('status-label');
    const waveViz = document.getElementById('wave-viz');
    
    // Check for persisted errors in the background
    const current = await chrome.storage.local.get(['currentLectureId']);
    let errorMessage = null;
    if (current.currentLectureId) {
        // We'd need to fetch the lecture from DB, but for now we'll check a dedicated error key
        const err = await chrome.storage.local.get(['last_error']);
        errorMessage = err.last_error;
    }

    if (synthesizing || recording) {
        document.getElementById('telemetry-panels').style.display = 'block';
    } else {
        document.getElementById('telemetry-panels').style.display = 'none';
        if (telemetryInterval) clearInterval(telemetryInterval);
    }

    if (synthesizing) {
        const prog = await chrome.storage.local.get(['progress_text']);
        actionBtnText.textContent = prog.progress_text || "TRANSCRIBING...";
        actionBtn.style.background = '#71717a'; 
        actionBtn.style.opacity = '0.5';
        actionBtn.style.pointerEvents = 'none';
        statusLabel.textContent = "INTELLIGENCE IN PROGRESS";
        statusLabel.style.color = '#6366f1';
        waveViz.style.display = 'none'; // Fixed: Hide red waves during synthesis
        chrome.storage.local.set({ last_error: null });

        // Start Telemetry
        if (telemetryInterval) clearInterval(telemetryInterval);
        if (current.currentLectureId) {
            telemetryInterval = setInterval(async () => {
                try {
                    const rawText = await getFullTranscript(current.currentLectureId);
                    const verbEl = document.getElementById('popup-verbatim');
                    
                    if (rawText && rawText.length > 5) {
                        verbEl.textContent = rawText;
                    } else {
                        verbEl.textContent = `[Deepgram Connection Active] Waiting for AI Text Stream...`;
                    }
                    verbEl.scrollTop = verbEl.scrollHeight;

                    const lecture = await getLecture(current.currentLectureId);
                    if (lecture) {
                        if (lecture.master_data) {
                            document.getElementById('popup-synthesis').textContent = JSON.stringify(lecture.master_data).substring(0, 500) + "...";
                        }
                        if (lecture.status === 'error') {
                            verbEl.textContent = "CRITICAL ERROR: " + lecture.error_message;
                        }
                    }
                } catch(e) {
                    console.error("Telemetry Error:", e);
                }
            }, 1000);
        }
    } else if (recording) {
        actionBtnText.textContent = "STOP SESSION";
        actionBtn.style.background = '#ef4444'; 
        actionBtn.style.opacity = '1';
        actionBtn.style.pointerEvents = 'auto';
        statusLabel.textContent = "SESSION IN PROGRESS";
        waveViz.style.display = 'flex';
        
        // Show live scribe during recording too
        if (telemetryInterval) clearInterval(telemetryInterval);
        telemetryInterval = setInterval(async () => {
            try {
                const current = await chrome.storage.local.get(['currentLectureId']);
                if (!current.currentLectureId) return;
                
                const rawText = await getFullTranscript(current.currentLectureId);
                const verbEl = document.getElementById('popup-verbatim');
                
                if (rawText && rawText.length > 5) {
                    verbEl.textContent = rawText;
                } else {
                    verbEl.textContent = "Listening for audio...";
                }
                verbEl.scrollTop = verbEl.scrollHeight;
            } catch(e) {}
        }, 1000);

    } else {
        actionBtnText.textContent = "START SESSION";
        actionBtn.style.background = '#ffffff'; 
        actionBtn.style.opacity = '1';
        actionBtn.style.pointerEvents = 'auto';
        statusLabel.textContent = errorMessage || "SYSTEM READY";
        if (errorMessage) statusLabel.style.color = '#f87171'; // Red for error
        else statusLabel.style.color = 'rgba(255, 255, 255, 0.5)';
        waveViz.style.display = 'none';
        stopTimer(true); // Reset timer UI only when system is ready again
    }
}

function startTimer(startTime) {
    const timerEl = document.getElementById('timer-display');
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = setInterval(() => {
        const elapsed = Date.now() - startTime;
        const mins = Math.floor(elapsed / 60000);
        const secs = Math.floor((elapsed % 60000) / 1000);
        timerEl.textContent = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }, 1000);
}

function stopTimer(resetUI = true) {
    const timerEl = document.getElementById('timer-display');
    if (timerInterval) clearInterval(timerInterval);
    if (resetUI) timerEl.textContent = '00:00';
}

