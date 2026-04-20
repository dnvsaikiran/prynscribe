// FINAL STABLE PRODUCTION: Dual-Core Pipeline
// Updated: Obsidian Elite v28

const INTERNAL_BASELINE_KEYS = {
    deepgram: "c876422b961e2da102bdd48edd51db30a7c8bb58",
    groq: "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",
    gemini: "AQ.Ab8RN6LGCsAHCidvvmjDYi_RRRACF33mDbZo5wD_aAyWOPCaYg"
};

async function getApiKeys() {
    const data = await chrome.storage.local.get(['deepgram_api_key', 'groq_api_key', 'gemini_api_key', 'userProfile']);
    const keys = {
        deepgram: data.deepgram_api_key || INTERNAL_BASELINE_KEYS.deepgram,
        groq: data.groq_api_key || INTERNAL_BASELINE_KEYS.groq, 
        gemini: data.gemini_api_key || INTERNAL_BASELINE_KEYS.gemini,
        user: data.userProfile || null
    };
    
    return keys;
}

async function callLLM(prompt, provider = 'groq', modelPref = null, systemPrompt = "") {
    const keys = await getApiKeys();
    let url, key, model;

    switch (provider) {
        case 'gemini':
            url = `https://generativelanguage.googleapis.com/v1beta/openai/v1/chat/completions?key=${keys.gemini}`;
            key = keys.gemini;
            model = modelPref || 'gemini-1.5-flash';
            break;
        case 'groq':
        default:
            url = 'https://api.groq.com/openai/v1/chat/completions';
            key = keys.groq;
            model = modelPref || 'llama-3.3-70b-versatile';
            break;
    }

    if (!key) throw new Error(`${provider.toUpperCase()} API Key is missing.`);

    const messages = [];
    if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
    const finalPrompt = provider === 'groq' ? `${prompt}\n\nIMPORTANT: Return the response in valid JSON format.` : prompt;
    messages.push({ role: 'user', content: finalPrompt });

    let attempts = 0;
    while (attempts < 2) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 60000); 

            const headers = { 'Content-Type': 'application/json' };
            if (provider === 'groq') headers['Authorization'] = `Bearer ${key}`;

            const response = await fetch(url, {
                method: 'POST',
                signal: controller.signal,
                headers: headers,
                body: JSON.stringify({
                    model: model,
                    messages: messages,
                    response_format: { type: "json_object" }
                })
            });

            clearTimeout(timeoutId);
            if (!response.ok) throw new Error(`AI error: ${response.status}`);

            const data = await response.json();
            return data.choices[0].message.content;
        } catch (e) {
            attempts++;
            if (attempts >= 2) throw e;
            await new Promise(r => setTimeout(r, 1000));
        }
    }
}

function cleanAndExtractJson(text) {
    try {
        let clean = text.replace(/```json/g, "").replace(/```/g, "").trim();
        const firstBrace = clean.indexOf("{");
        const lastBrace = clean.lastIndexOf("}");
        if (firstBrace !== -1 && lastBrace !== -1) {
            clean = clean.substring(firstBrace, lastBrace + 1);
            return JSON.parse(clean);
        }
        return {};
    } catch (e) { return {}; }
}

export async function processTranscriptChunk(chunkText) {
    if (!chunkText || chunkText.trim().length < 20) return { topics: [] };
    const prompt = `Extract academic concepts and key topics as JSON from: ${chunkText}. Return: {"topics":[], "key_points":[], "definitions":[]}`;
    try {
        const result = await callLLM(prompt, 'groq', 'llama-3.1-8b-instant');
        return cleanAndExtractJson(result);
    } catch (e) { return { topics: [] }; }
}

/**
 * ELITE SYNTHESIS ENGINE — 10 Mode Router
 * Takes a full transcript and a mode, returns a rich structured artifact.
 */
export async function genSynthesisArtifact(fullTranscript, engine, mode = 'exam') {
    if (!fullTranscript || fullTranscript.length < 50) {
        return { title: "Session", summary: "Recording completed but transcript was too short.", mode };
    }
    const systemPrompt = engine.getSystemPrompt(mode);
    const userPrompt = engine.wrapTranscript(fullTranscript);
    
    let attempts = 0;
    while (attempts < 3) {
        try {
            const result = await callLLM(userPrompt, 'groq', 'llama-3.3-70b-versatile', systemPrompt);
            const parsed = cleanAndExtractJson(result);
            if (parsed && (parsed.title || parsed.summary || parsed.narrative_script)) {
                parsed.mode = parsed.mode || mode;
                return parsed;
            }
            throw new Error("Empty or invalid artifact returned");
        } catch (e) {
            attempts++;
            console.warn(`[AI] genSynthesisArtifact attempt ${attempts} failed: ${e.message}`);
            if (attempts < 3) await new Promise(r => setTimeout(r, 1500 * attempts));
        }
    }
    // Final fallback — use Gemini if Groq fails all 3 attempts
    try {
        const systemPrompt = engine.getSystemPrompt(mode);
        const userPrompt = engine.wrapTranscript(fullTranscript);
        const result = await callLLM(userPrompt, 'gemini', 'gemini-1.5-flash', systemPrompt);
        const parsed = cleanAndExtractJson(result);
        parsed.mode = mode;
        return parsed;
    } catch (e) {
        return { title: "Session", summary: "Synthesis failed. Please retry.", mode };
    }
}

// Legacy compatibility — maps to genSynthesisArtifact in exam mode
export async function genCoreNotes(combinedData, engine) {
    const transcript = typeof combinedData === 'string' 
        ? combinedData 
        : combinedData.map(d => d.transcript_raw || JSON.stringify(d)).join('\n');
    return genSynthesisArtifact(transcript, engine, 'exam');
}



/**
 * LANGUAGE-AWARE TRANSCRIPTION ENGINE
 * Returns { transcript, detectedLang } — preserving source language.
 * Deepgram primary with detect_language=true. Groq Whisper fallback.
 */
export async function transcribeChunk(audioBase64, preferredLang = null) {
    try {
        const mimeType = 'audio/webm';
        const baseRaw = audioBase64.split(',')[1] || audioBase64;
        const byteArray = new Uint8Array(atob(baseRaw).split('').map(c => c.charCodeAt(0)));
        const audioBlob = new Blob([byteArray], { type: mimeType });
        if (audioBlob.size < 2000) return { transcript: '', detectedLang: preferredLang || 'en' };

        const keys = await getApiKeys();

        // ── PRIMARY: DEEPGRAM nova-2 with language detection ────────────
        if (keys.deepgram) {
            try {
                const langParam = preferredLang ? `&language=${preferredLang}` : `&detect_language=true`;
                const dgRes = await fetch(
                    `https://api.deepgram.com/v1/listen?model=nova-2&smart_format=true${langParam}`,
                    {
                        method: 'POST',
                        headers: { 'Authorization': `Token ${keys.deepgram}`, 'Content-Type': mimeType },
                        body: audioBlob
                    }
                );
                if (dgRes.ok) {
                    const data = await dgRes.json();
                    const channel = data.results?.channels?.[0];
                    const transcript = channel?.alternatives?.[0]?.transcript || '';
                    const detectedLang = channel?.detected_language || preferredLang || 'en';
                    if (transcript) console.log(`[Deepgram] ✓ "${transcript.substring(0,35)}..." [${detectedLang}]`);
                    // Broadcast language detection to popup
                    try { chrome.runtime.sendMessage({ type: 'language_detected', lang: detectedLang }); } catch(_) {}
                    return { transcript, detectedLang };
                }
                console.warn(`[Deepgram] HTTP ${dgRes.status}`);
            } catch (e) {
                console.warn(`[Deepgram] ${e.message}`);
            }
        }

        // ── FALLBACK: GROQ WHISPER (source language, verbose_json) ─────
        const formData = new FormData();
        formData.append('file', audioBlob, 'chunk.webm');
        formData.append('model', 'whisper-large-v3-turbo');
        if (preferredLang) formData.append('language', preferredLang);
        formData.append('response_format', 'verbose_json');

        const groqRes = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${keys.groq}` },
            body: formData
        });

        if (groqRes.ok) {
            const data = await groqRes.json();
            const transcript = data.text || '';
            const detectedLang = data.language || preferredLang || 'en';
            console.log(`[Groq Whisper] ✓ "${transcript.substring(0,35)}..." [${detectedLang}]`);
            try { chrome.runtime.sendMessage({ type: 'language_detected', lang: detectedLang }); } catch(_) {}
            return { transcript, detectedLang };
        }

        return { transcript: '', detectedLang: preferredLang || 'en' };
    } catch (e) {
        console.error('[Transcription] Error:', e.message);
        return { transcript: '', detectedLang: preferredLang || 'en' };
    }
}

export async function askLectureBot(query, transcript, history) {
    const context = transcript?.substring(0, 6000) || '';
    const historyStr = (history || []).slice(-4).map(m => `${m.role}: ${m.content}`).join('\n');
    const prompt = `You are a concise AI tutor. Answer ONLY based on the transcript provided.\nHISTORY:\n${historyStr}\n\nQUESTION: ${query}\n\nTRANSCRIPT:\n${context}`;
    return callLLM(prompt, 'groq', 'llama-3.3-70b-versatile', 'You are a concise, accurate AI tutor. Never hallucinate.');
}


