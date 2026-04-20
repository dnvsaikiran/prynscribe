// content/script.js
// Handles tab-level interactions like speed boost and recording indicators.
// OVERHAUL: Event-driven architecture (No Polling) to prevent "Context Invalidated" loops.

(function() {
    if (window.__prysm_script_injected) return;
    window.__prysm_script_injected = true;

    let recordingSignal = null;
    let targetSpeed = 1.0;
    let targetVolume = 1.0;

    // --- INITIAL STATE ---
    function syncFromStorage() {
        try {
            chrome.storage.local.get(['currentSpeed', 'currentVolume'], (data) => {
                if (chrome.runtime.lastError) return;
                targetSpeed = data.currentSpeed ? parseFloat(data.currentSpeed) : 1.0;
                targetVolume = data.currentVolume !== undefined ? parseInt(data.currentVolume) / 100 : 1.0;
                applySettings(targetSpeed, targetVolume);
            });
        } catch (e) {}
    }

    syncFromStorage();

    // --- BROADCAST EXTENSION ID TO WEBSITE ---
    // This allows index.js to know which ID to send messages to, especially in development.
    if (window.location.hostname === 'prynsc-scribe.web.app' || window.location.hostname === 'localhost') {
        console.log("[PrynScribe] Broadcasting extension ID:", chrome.runtime.id);
        window.postMessage({ type: 'PRYNSCRIBE_EXTENSION_READY', extensionId: chrome.runtime.id }, '*');
    }
    
    // Watch for soft-navigations (SPA) to re-apply settings
    window.addEventListener('popstate', syncFromStorage);
    window.addEventListener('locationchange', syncFromStorage); 
    
    // Periodic sync: Ensures extension remains the source of truth
    setInterval(() => {
        syncFromStorage();
        // Always apply if we have a valid target, to maintain dominance over site-level overrides
        applySettings(targetSpeed, targetVolume);
    }, 1500);

    // --- MESSAGE HANDLER ---
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
        try {
            if (msg.type === 'ping') {
                sendResponse({ status: 'pong' });
            } else if (msg.type === 'setSpeed') {
                targetSpeed = msg.speed;
                applySettings(targetSpeed, targetVolume);
                sendResponse({ status: 'speedSet', speed: targetSpeed });
            } else if (msg.type === 'setVolume') {
                targetVolume = msg.volume / 100;
                applySettings(targetSpeed, targetVolume);
                sendResponse({ status: 'volumeSet', volume: targetVolume });
            } else if (msg.type === 'signal_level') {
                // If we are on the PrynScribe dashboard, forward the pulse to the page
                if (window.location.host.includes('prynsc-scribe.web.app') || window.location.host.includes('localhost')) {
                    window.postMessage({ type: 'PRYNSCRIBE_PULSE', level: msg.level }, '*');
                }
            } else if (msg.type === 'control') {
                if (msg.action === 'start') {
                    showSignal();
                    sendResponse({ status: 'started' });
                } else if (msg.action === 'stop') {
                    hideSignal();
                    sendResponse({ status: 'stopped' });
                }
            }
        } catch (e) {
            // Context invalidated during msg handling
        }
        return true;
    });

    window.addEventListener('message', (event) => {
        if (event.data && event.data.type === 'PRYSM_AUTH_TRANSFER') {
            chrome.runtime.sendMessage({ type: 'AUTH_SYNC', profile: event.data.profile });
        }
    });

    // --- LIVE SYNC FOR INDICATOR ---
    chrome.storage.onChanged.addListener((changes) => {
        if (changes.pref_indicator && recordingSignal) {
            const newStyle = changes.pref_indicator.newValue || 'style-pulse';
            updateIndicatorStyle(newStyle);
        }
    });

    function updateIndicatorStyle(styleClass) {
        if (!recordingSignal) return;
        // Strip existing styles
        recordingSignal.className = 'prysm-indicator-base ' + styleClass;
    }

    function syncToMain(speed, volume) {
        window.postMessage({ type: 'PRYSM_SYNC', speed, volume }, '*');
    }

    function applySettings(speed, volume) {
        const queryVideos = (root) => {
            let videos = Array.from(root.querySelectorAll('video'));
            const allElements = root.querySelectorAll('*');
            allElements.forEach(el => {
                if (el.shadowRoot) {
                    videos = videos.concat(queryVideos(el.shadowRoot));
                }
            });
            return videos;
        };

        const allVideos = queryVideos(document);
        allVideos.forEach(video => {
            try {
                video.playbackRate = speed;
                video.volume = volume;
            } catch (e) {}
        });
        syncToMain(speed, volume);
    }

    // --- MUTATION OBSERVER (Replacement for setInterval) ---
    // Native browser API: No "Extension Context" required.
    const observer = new MutationObserver((mutations) => {
        let needsApply = false;
        for (const mutation of mutations) {
            if (mutation.addedNodes.length) {
                mutation.addedNodes.forEach(node => {
                    if (node.nodeName === 'VIDEO' || (node.querySelector && node.querySelector('video'))) {
                        needsApply = true;
                    }
                });
            }
        }
        if (needsApply) applySettings(targetSpeed, targetVolume);
    });

    observer.observe(document.documentElement, { childList: true, subtree: true });

    async function showSignal() {
        if (recordingSignal || !document.body) return;
        
        // 1. Get Preference
        const data = await chrome.storage.local.get(['pref_indicator']);
        const styleClass = data.pref_indicator || 'style-pulse';

        // 2. Inject Stylesheet if not already present
        if (!document.getElementById('prysm-indicator-css')) {
            const link = document.createElement('link');
            link.id = 'prysm-indicator-css';
            link.rel = 'stylesheet';
            link.href = chrome.runtime.getURL('content/indicators.css');
            document.head.appendChild(link);
        }

        // 3. Create Element
        recordingSignal = document.createElement('div');
        recordingSignal.id = 'prysm-recording-signal';
        recordingSignal.className = `prysm-indicator-base ${styleClass}`;
        
        recordingSignal.innerHTML = `
            <div class="prysm-indicator-shape"></div>
            <span class="prysm-indicator-label">REC ACTIVE</span>
        `;
        
        document.body.appendChild(recordingSignal);

        // Individual overrides for the label
        const style = document.createElement('style');
        style.id = 'prysm-label-styles';
        style.innerHTML = `
            #prysm-recording-signal .prysm-indicator-label {
                position: absolute;
                right: 30px;
                font-size: 10px;
                font-weight: 900;
                color: white;
                background: rgba(0,0,0,0.8);
                padding: 4px 10px;
                border-radius: 4px;
                opacity: 0;
                transform: translateX(10px);
                transition: all 0.3s ease;
                pointer-events: none;
                white-space: nowrap;
                letter-spacing: 0.1em;
            }
            #prysm-recording-signal:hover .prysm-indicator-label {
                opacity: 1;
                transform: translateX(0);
            }
        `;
        document.head.appendChild(style);
    }

    function hideSignal() {
        if (recordingSignal) {
            recordingSignal.remove();
            recordingSignal = null;
        }
        const style = document.getElementById('prysm-styles-v2');
        if (style) style.remove();
    }
})();
