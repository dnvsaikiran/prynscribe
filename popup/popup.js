// popup/popup.js
import { getFullTranscript } from '../lib/db.js';

// UI Elements
let actionBtn, actionBtnText, speedSlider, speedIndicator, timerDisplay, statusTicker, verbatimBox;
let webAccountLink, emergencyReset, waveViz, timerDigits;

// Local State
let isRecording = false;
let isSynthesizing = false;
let timerInterval = null;
let telemetryInterval = null;

document.addEventListener('DOMContentLoaded', async () => {
    initElements();
    initEventListeners();
    
    // Auth Check
    const state = await chrome.storage.local.get(['userProfile']);
    if (!state.userProfile) {
        if (statusTicker) statusTicker.textContent = "AUTH REQUIRED";
    }

    restoreState();
    initLanguageIndicator();
});

function initElements() {
    actionBtn = document.getElementById('actionBtn');
    actionBtnText = document.getElementById('action-text');
    speedSlider = document.getElementById('speed-slider');
    speedIndicator = document.getElementById('speed-indicator');
    timerDisplay = document.getElementById('timer-display');
    statusTicker = document.getElementById('status-ticker');
    verbatimBox = document.getElementById('popup-verbatim');
    webAccountLink = document.getElementById('web-account-link');
    emergencyReset = document.getElementById('btn-emergency-reset');
    waveViz = document.getElementById('wave-viz');
    timerDigits = document.getElementById('timer-display');
}

function initEventListeners() {
    if (speedSlider) {
        speedSlider.addEventListener('input', async (e) => {
            const speed = e.target.value;
            if (speedIndicator) speedIndicator.textContent = `${parseFloat(speed).toFixed(1)}x`;
            await chrome.storage.local.set({ currentSpeed: speed });
            await safeSendSpeed(parseFloat(speed));
        });
    }

    if (actionBtn) actionBtn.addEventListener('click', handleActionClick);
    if (webAccountLink) webAccountLink.addEventListener('click', () => chrome.tabs.create({ url: "https://prynsc-scribe.web.app" }));
    
    if (emergencyReset) {
        emergencyReset.addEventListener('click', async () => {
            if (confirm("TERMINATE SESSION?")) {
                await chrome.storage.local.set({ isRecording: false, isSynthesizing: false });
                chrome.runtime.sendMessage({ type: 'control', action: 'stop' });
                location.reload();
            }
        });
    }

    const modeBtns = document.querySelectorAll('.mode-btn');
    if (modeBtns) {
        modeBtns.forEach(btn => {
            btn.addEventListener('click', async () => {
                if (isRecording) {
                    alert("Cannot change mode while a recording session is active.");
                    return;
                }
                modeBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                const newMode = btn.dataset.mode;
                await chrome.storage.local.set({ currentMode: newMode });
                console.log("[Popup] Mode changed to:", newMode);
            });
        });
    }

    chrome.storage.onChanged.addListener((changes, namespace) => {
        if (namespace === 'local') {
            if (changes.isSynthesizing) { isSynthesizing = changes.isSynthesizing.newValue; updateUI(); }
            if (changes.isRecording) { 
                isRecording = changes.isRecording.newValue; 
                if (isRecording) { startTelemetryLoop(); timerDigits?.classList.add('active'); }
                else { stopTelemetryLoop(); timerDigits?.classList.remove('active'); }
                updateUI(); 
            }
            if (changes.progress_text) { if (statusTicker) statusTicker.textContent = changes.progress_text.newValue.toUpperCase(); }
        }
    });

    chrome.runtime.onMessage.addListener((msg) => {
        if (msg.type === 'signal_level') {
            if (waveViz && isRecording) {
                waveViz.style.opacity = '1';
                const bars = waveViz.querySelectorAll('.wave-bar-pro');
                bars.forEach((bar, i) => {
                    // Parabolic center-weighted distribution for 14 bars
                    const distanceToCenter = Math.abs(i - 6.5); // Center is between 6 and 7
                    const weight = 1.0 - (distanceToCenter / 10);
                    const height = Math.min(100, Math.max(15, msg.level * weight * 1.5)) + '%';
                    bar.style.height = height;
                });
            }
        } else if (msg.type === 'transcript_update' && verbatimBox) {
            updateVerbatimUI(msg.text);
        } else if (msg.type === 'language_detected') {
            updateLanguageIndicator(msg.lang);
        } else if (msg.type === 'synthesis_complete') {
            isSynthesizing = false;
            chrome.storage.local.set({ isSynthesizing: false });
            updateUI();
            if (waveViz) waveViz.style.opacity = '0';
            if (msg.lectureId) {
                chrome.tabs.create({ url: chrome.runtime.getURL(`public/pages/transcript_v2.html?id=${msg.lectureId}`) });
            }
        }
    });
}

/**
 * MASTER FIX: Safely sends speed even if content script is missing or orphaned.
 */
async function safeSendSpeed(speed) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return;
    
    try {
        // Try to ping the script to see if it's there
        await chrome.tabs.sendMessage(tab.id, { type: 'ping' });
        await chrome.tabs.sendMessage(tab.id, { type: 'setSpeed', speed });
    } catch (e) {
        console.log("[Popup] Content script missing or invalid. Auto-repairing...");
        // NUCLEAR RE-INJECTION: Make speed work without reload
        await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['content/script.js']
        });
        // Try again after a small delay
        setTimeout(() => chrome.tabs.sendMessage(tab.id, { type: 'setSpeed', speed }), 200);
    }
}

function startTelemetryLoop() {
    if (telemetryInterval) clearInterval(telemetryInterval);
    // Increased frequency: 750ms for snappier Scribe feeling
    telemetryInterval = setInterval(async () => {
        const state = await chrome.storage.local.get(['currentLectureId']);
        if (state.currentLectureId) {
            const text = await getFullTranscript(state.currentLectureId);
            if (text) updateVerbatimUI(text);
        }
    }, 750); 
}

function stopTelemetryLoop() {
    if (telemetryInterval) clearInterval(telemetryInterval);
    telemetryInterval = null;
}

function updateVerbatimUI(text) {
    if (!verbatimBox) return;
    if (!text || text.trim().length === 0) {
        if (isRecording) verbatimBox.innerHTML = '<span style="color:rgba(255,255,255,0.3);">📍 Waiting for audio signal...</span>';
        return;
    }
    const displayText = text.length > 3000 ? '...' + text.slice(-3000) : text;
    verbatimBox.textContent = displayText;
    verbatimBox.scrollTop = verbatimBox.scrollHeight;
}

// Language indicator flags/labels
const LANG_META = {
    'en':{'label':'English','flag':'🇬🇧'}, 'hi':{'label':'Hindi','flag':'🇮🇳'},
    'te':{'label':'Telugu','flag':'🇮🇳'}, 'ta':{'label':'Tamil','flag':'🇮🇳'},
    'kn':{'label':'Kannada','flag':'🇮🇳'}, 'ml':{'label':'Malayalam','flag':'🇮🇳'},
    'es':{'label':'Spanish','flag':'🇪🇸'}, 'fr':{'label':'French','flag':'🇫🇷'},
    'de':{'label':'German','flag':'🇩🇪'}, 'pt':{'label':'Portuguese','flag':'🇧🇷'},
    'ar':{'label':'Arabic','flag':'🇸🇦'}, 'ja':{'label':'Japanese','flag':'🇯🇵'},
    'ko':{'label':'Korean','flag':'🇰🇷'}, 'zh':{'label':'Chinese','flag':'🇨🇳'}
};

function updateLanguageIndicator(langCode) {
    const meta = LANG_META[langCode] || { label: langCode?.toUpperCase() || 'Unknown', flag: '🌐' };
    const flagEl = document.getElementById('source-lang-flag');
    const labelEl = document.getElementById('source-lang-label');
    if (flagEl) flagEl.textContent = meta.flag;
    if (labelEl) labelEl.textContent = meta.label;
}

async function initLanguageIndicator() {
    const state = await chrome.storage.local.get(['detectedSourceLang', 'preferredOutputLang', 'userProfile']);
    if (state.detectedSourceLang) updateLanguageIndicator(state.detectedSourceLang);
    const outCode = state.preferredOutputLang || 'en';
    const outLabel = document.getElementById('output-lang-label');
    if (outLabel) outLabel.textContent = (LANG_META[outCode]?.label) || 'English';
    // Show 'CHANGE' button to pro/elite users
    const tier = state.userProfile?.tier || 'free';
    const changeBtn = document.getElementById('lang-change-btn');
    if (changeBtn && (tier === 'pro' || tier === 'elite')) changeBtn.style.display = 'block';
}


async function handleActionClick() {
    if (isSynthesizing) return;
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url || tab.url.startsWith('chrome://')) {
        alert("Action Required: Please open a web page with audio (e.g. YouTube).");
        return;
    }

    if (!isRecording) {
        chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id }, async (streamId) => {
            if (streamId) startFlow(tab, streamId);
            else alert("System Error: No audio endpoint detected.");
        });
    } else {
        stopFlow();
    }
}

async function startFlow(tab, streamId) {
    const lectureId = Date.now().toString();
    const startTime = Date.now();
    const config = await chrome.storage.local.get(['currentMode', 'userRegion', 'currentGoal', 'currentSpeed']);
    
    await chrome.storage.local.set({ isRecording: true, recordingStartTime: startTime, currentLectureId: lectureId });
    isRecording = true;
    updateUI();
    startTimer(startTime);
    startTelemetryLoop();
    
    chrome.runtime.sendMessage({ 
        type: 'control', 
        action: 'start', 
        lectureId, 
        streamId, 
        mode: config.currentMode || 'general',
        goal: config.currentGoal || 'Neural Synthesis',
        region: config.userRegion || 'GLOBAL',
        speed: parseFloat(config.currentSpeed || 1.0) 
    });
    if (statusTicker) statusTicker.textContent = "NEURAL BRIDGE ACTIVE";
}

async function stopFlow() {
    const state = await chrome.storage.local.get(['currentLectureId']);
    isRecording = false;
    isSynthesizing = true;
    updateUI();
    stopTimer();
    stopTelemetryLoop();
    chrome.runtime.sendMessage({ type: 'control', action: 'stop', lectureId: state.currentLectureId });
    await chrome.storage.local.set({ isRecording: false, isSynthesizing: true });
}

async function updateUI() {
    if (isSynthesizing) {
        if (actionBtnText) actionBtnText.textContent = "SYNCHRONIZING...";
        if (actionBtn) actionBtn.style.opacity = '0.5';
    } else if (isRecording) {
        if (actionBtnText) actionBtnText.textContent = "STOP SESSION";
        if (actionBtn) actionBtn.style.background = '#ef4444';
    } else {
        if (actionBtnText) actionBtnText.textContent = "START SESSION";
        if (actionBtn) {
            actionBtn.style.background = '#fff';
            actionBtn.style.opacity = '1';
        }
        if (statusTicker) statusTicker.textContent = "SYSTEM ACTIVE";
    }
}

async function restoreState() {
    const state = await chrome.storage.local.get(['isRecording', 'isSynthesizing', 'recordingStartTime', 'currentSpeed']);
    isRecording = state.isRecording || false;
    isSynthesizing = state.isSynthesizing || false;
    
    if (state.currentSpeed && speedSlider) {
        speedSlider.value = state.currentSpeed;
        if (speedIndicator) speedIndicator.textContent = `${parseFloat(state.currentSpeed).toFixed(1)}x`;
    }

    updateUI();
    if (isRecording) {
        if (state.recordingStartTime) startTimer(state.recordingStartTime);
        startTelemetryLoop();
        timerDigits?.classList.add('active');
    }
}

function startTimer(startTime) {
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = setInterval(() => {
        const elapsed = Date.now() - startTime;
        const mins = Math.floor(elapsed / 60000);
        const secs = Math.floor((elapsed % 60000) / 1000);
        if (timerDisplay) timerDisplay.textContent = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }, 1000);
}

function stopTimer() {
    if (timerInterval) clearInterval(timerInterval);
}
