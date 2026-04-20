// popup/navigation.js
// --- ROBUST NAVIGATION HANDLER (NON-MODULE) ---
// This ensures buttons work instantly, even if Firebase takes time to load.
(function() {
    const WEBSITE_URL = "https://prynsc-scribe.web.app";
    document.addEventListener('click', (e) => {
        const target = e.target.closest('#overlay-login-btn, #web-account-link');
        if (target) {
            console.log("[Navigation] Opening website...");
            chrome.tabs.create({ url: WEBSITE_URL });
        }
        
        const libBtn = e.target.closest('#view-library');
        if (libBtn) {
            console.log("[Navigation] Opening library...");
            chrome.tabs.create({ url: chrome.runtime.getURL('pages/library.html') });
        }
    });
    console.log("[Popup] Navigation handler active.");
})();
