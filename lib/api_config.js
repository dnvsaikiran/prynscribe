// lib/api_config.js
// Centralized API Configuration for PrynScribe Pro

export const API_KEYS = {
    deepgram: "c876422b961e2da102bdd48edd51db30a7c8bb58",
    groq: "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",
    gemini: "" // Add if provided later
};

/**
 * Ensures the extension storage is primed with the latest keys.
 * Use this during startup or on auth sync.
 */
export async function syncKeysToStorage() {
    try {
        await chrome.storage.local.set({
            deepgram_api_key: API_KEYS.deepgram,
            groq_api_key: API_KEYS.groq
        });
        console.log("[Sync] API Keys primed to local storage.");
    } catch (e) {
        console.error("[Sync] Failed to seed API keys:", e);
    }
}
