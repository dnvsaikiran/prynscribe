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
    // Try to get cached settings ONCE at injection.
    try {
        chrome.storage.local.get(['currentSpeed', 'currentVolume'], (data) => {
            if (chrome.runtime.lastError) return;
            targetSpeed = data.currentSpeed ? parseFloat(data.currentSpeed) : 1.0;
            targetVolume = data.currentVolume !== undefined ? parseInt(data.currentVolume) / 100 : 1.0;
            applySettings(targetSpeed, targetVolume);
        });
    } catch (e) {
        // Silent fail: context was already invalidated during injection.
    }

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

    function showSignal() {
        if (recordingSignal || !document.body) return;
        recordingSignal = document.createElement('div');
        recordingSignal.id = 'prysm-recording-signal';
        recordingSignal.innerHTML = `
            <div class="prysm-dot"></div>
            <span class="prysm-label">SYSTEM ACTIVE</span>
        `;
        
        Object.assign(recordingSignal.style, {
            position: 'fixed', bottom: '20px', left: '20px',
            zIndex: '2147483647', display: 'flex', alignItems: 'center',
            cursor: 'pointer', transition: 'all 0.3s ease'
        });

        document.body.appendChild(recordingSignal);

        const style = document.createElement('style');
        style.id = 'prysm-styles-v2';
        style.innerHTML = `
            #prysm-recording-signal .prysm-dot {
                width: 12px; height: 12px; 
                background: #3b82f6; 
                border-radius: 50%; 
                box-shadow: 0 0 15px rgba(59, 130, 246, 0.6);
                animation: prysm-pulse 2s infinite;
            }
            #prysm-recording-signal .prysm-label {
                margin-left: 10px;
                font-size: 10px;
                font-weight: 900;
                color: white;
                background: rgba(0,0,0,0.8);
                padding: 4px 10px;
                border-radius: 4px;
                opacity: 0;
                transform: translateX(-10px);
                transition: all 0.3s ease;
                pointer-events: none;
                white-space: nowrap;
                letter-spacing: 0.1em;
            }
            #prysm-recording-signal:hover .prysm-label {
                opacity: 1;
                transform: translateX(0);
            }
            @keyframes prysm-pulse {
                0% { transform: scale(1); box-shadow: 0 0 0 0 rgba(59, 130, 246, 0.7); }
                70% { transform: scale(1.2); box-shadow: 0 0 0 10px rgba(59, 130, 246, 0); }
                100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(59, 130, 246, 0); }
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
