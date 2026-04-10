// content/inject.js
// Runs in the MAIN world to directly override site-level media properties.
// This is necessary because YouTube and other sites can bypass "Isolated World" scripts.

(function() {
    let targetSpeed = 1.0;
    let targetVolume = 1.0;
    let isLocked = false;

    // Listen for updates from the Isolated World (content/script.js)
    window.addEventListener('message', (event) => {
        if (event.data && event.data.type === 'PRYSM_SYNC') {
            targetSpeed = event.data.speed;
            targetVolume = event.data.volume;
            isLocked = true;
            applyNow();
        }
    });

    function applyNow() {
        const videos = document.querySelectorAll('video');
        videos.forEach(v => {
            // Direct set using native descriptors to bypass site overrides
            try {
                const speedDesc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'playbackRate');
                const volDesc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'volume');
                
                speedDesc.set.call(v, targetSpeed);
                volDesc.set.call(v, targetVolume);
            } catch (e) {
                v.playbackRate = targetSpeed;
                v.volume = targetVolume;
            }
        });
    }

    // PERSISTENT PROTOTYPE LOCK
    // This intercepts any attempt by the site (YouTube) to change the speed or volume
    const originalSpeedDescriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'playbackRate');
    Object.defineProperty(HTMLMediaElement.prototype, 'playbackRate', {
        get: originalSpeedDescriptor.get,
        set: function(val) {
            if (isLocked) {
                return originalSpeedDescriptor.set.call(this, targetSpeed);
            }
            return originalSpeedDescriptor.set.call(this, val);
        },
        configurable: true
    });

    const originalVolDescriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'volume');
    Object.defineProperty(HTMLMediaElement.prototype, 'volume', {
        get: originalVolDescriptor.get,
        set: function(val) {
            if (isLocked) {
                return originalVolDescriptor.set.call(this, targetVolume);
            }
            return originalVolDescriptor.set.call(this, val);
        },
        configurable: true
    });

    // Run periodically to catch new videos (e.g. YouTube playlist transitions)
    setInterval(applyNow, 500);
})();
