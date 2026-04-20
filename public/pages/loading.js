// pages/loading.js
// Listens for status updates from the background worker and updates the UI progress.

document.addEventListener('DOMContentLoaded', () => {
    const currentStatus = document.getElementById('current-status');
    const lectureTitle = document.getElementById('lecture-title');

    // Retrieve the current lecture details
    chrome.storage.local.get(['currentLectureId'], (result) => {
        const lectureId = result.currentLectureId;
        // In a real app, you'd fetch the lecture title from DB here
        lectureTitle.textContent = `Lecture ID: ${lectureId}`;
    });

    const steps = {
        capture: document.getElementById('step-capture'),
        transcribe: document.getElementById('step-transcribe'),
        clean: document.getElementById('step-clean'),
        extract: document.getElementById('step-extract'),
        notes: document.getElementById('step-notes'),
        tags: document.getElementById('step-tags'),
        finalize: document.getElementById('step-finalize')
    };

    function updateStep(stepId, state) {
        const el = steps[stepId];
        if (!el) return;
        el.classList.remove('active', 'done');
        if (state === 'active') el.classList.add('active');
        if (state === 'done') el.classList.add('done');
    }

    chrome.runtime.onMessage.addListener((msg) => {
        if (msg.type === 'status_update') {
            currentStatus.textContent = msg.message;
            
            if (msg.step) {
                // Logic to mark steps as active/done
                Object.keys(steps).forEach(s => {
                    if (s === msg.step) {
                        updateStep(s, 'active');
                    }
                });
            }

            if (msg.done) {
                updateStep(msg.done, 'done');
            }

            if (msg.type === 'processing_complete') {
                updateStep('finalize', 'done');
                currentStatus.textContent = 'Complete! Redirecting...';
                setTimeout(() => {
                    window.location.href = `lecture.html?id=${msg.lectureId}`;
                }, 1500);
            }
        }
    });
});
