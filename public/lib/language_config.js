// lib/language_config.js
// Multilingual support layer for PrynScribe

// ==================================================
// SUPPORTED LANGUAGES
// ==================================================
export const SUPPORTED_LANGUAGES = {
    'en':  { label: 'English',    native: 'English',     flag: '🇬🇧', deepgramCode: 'en',    groqCode: 'english'  },
    'hi':  { label: 'Hindi',      native: 'हिन्दी',        flag: '🇮🇳', deepgramCode: 'hi',    groqCode: 'hindi'    },
    'te':  { label: 'Telugu',     native: 'తెలుగు',       flag: '🇮🇳', deepgramCode: 'te',    groqCode: 'telugu'   },
    'ta':  { label: 'Tamil',      native: 'தமிழ்',        flag: '🇮🇳', deepgramCode: 'ta',    groqCode: 'tamil'    },
    'kn':  { label: 'Kannada',    native: 'ಕನ್ನಡ',        flag: '🇮🇳', deepgramCode: 'kn',    groqCode: 'kannada'  },
    'ml':  { label: 'Malayalam',  native: 'മലയാളം',       flag: '🇮🇳', deepgramCode: 'ml',    groqCode: 'malayalam'},
    'es':  { label: 'Spanish',    native: 'Español',     flag: '🇪🇸', deepgramCode: 'es',    groqCode: 'spanish'  },
    'fr':  { label: 'French',     native: 'Français',    flag: '🇫🇷', deepgramCode: 'fr',    groqCode: 'french'   },
    'de':  { label: 'German',     native: 'Deutsch',     flag: '🇩🇪', deepgramCode: 'de',    groqCode: 'german'   },
    'pt':  { label: 'Portuguese', native: 'Português',   flag: '🇧🇷', deepgramCode: 'pt',    groqCode: 'portuguese'},
    'ar':  { label: 'Arabic',     native: 'العربية',     flag: '🇸🇦', deepgramCode: 'ar',    groqCode: 'arabic'   },
    'ja':  { label: 'Japanese',   native: '日本語',        flag: '🇯🇵', deepgramCode: 'ja',    groqCode: 'japanese' },
    'ko':  { label: 'Korean',     native: '한국어',        flag: '🇰🇷', deepgramCode: 'ko',    groqCode: 'korean'   },
    'zh':  { label: 'Chinese',    native: '中文',          flag: '🇨🇳', deepgramCode: 'zh',    groqCode: 'chinese'  },
    'ru':  { label: 'Russian',    native: 'Русский',     flag: '🇷🇺', deepgramCode: 'ru',    groqCode: 'russian'  },
};

// ==================================================
// TIER PERMISSIONS
// ==================================================
export const LANGUAGE_TIER_PERMISSIONS = {
    free: {
        canChooseLiveLanguage: false,
        canChooseOutputLanguage: false,
        canRetranslate: false,
        canExportMultiLanguage: false,
        canSeeDualView: false,
        autoDetect: true,
        outputLanguages: ['en']
    },
    pro: {
        canChooseLiveLanguage: true,
        canChooseOutputLanguage: true,
        canRetranslate: false,
        canExportMultiLanguage: false,
        canSeeDualView: false,
        autoDetect: true,
        outputLanguages: Object.keys(SUPPORTED_LANGUAGES)
    },
    elite: {
        canChooseLiveLanguage: true,
        canChooseOutputLanguage: true,
        canRetranslate: true,
        canExportMultiLanguage: true,
        canSeeDualView: true,
        autoDetect: true,
        outputLanguages: Object.keys(SUPPORTED_LANGUAGES)
    }
};

// ==================================================
// PROVIDER ROUTING STRATEGY
// ==================================================
// Deepgram: Best for South Asian, East Asian, European languages
// Groq Whisper: Best fallback for anything Deepgram misses
export const TRANSCRIPTION_PROVIDER = (langCode, userTier) => {
    // Deepgram supports most languages natively with nova-2
    const deepgramSupported = ['en','hi','te','ta','kn','ml','es','fr','de','pt','ar','ja','ko','zh','ru'];
    if (deepgramSupported.includes(langCode)) return 'deepgram';
    return 'groq'; // Whisper fallback
};

// ==================================================
// TRANSLATION ENGINE
// ==================================================
// Translates full assembled transcript text using LLM
export async function translateTranscript(text, sourceLang, targetLang, groqKey) {
    if (!text || sourceLang === targetLang) return text;

    const sourceLangName = SUPPORTED_LANGUAGES[sourceLang]?.label || sourceLang;
    const targetLangName = SUPPORTED_LANGUAGES[targetLang]?.label || targetLang;

    const prompt = `You are a professional multilingual translator specialized in academic content.

TASK: Translate the following ${sourceLangName} transcript into ${targetLangName}.

RULES:
1. Preserve ALL technical terms, proper nouns, acronyms, and subject-specific vocabulary intact.
2. Translate meaning naturally — do not translate word-for-word awkwardly.
3. Maintain the original structure (paragraphs, flow, segments).
4. Do NOT add, remove, or invent any content.
5. Output ONLY the translated text, nothing else.

TRANSCRIPT:
${text}`;

    try {
        const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${groqKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: 'llama-3.3-70b-versatile',
                messages: [{ role: 'user', content: prompt }],
                temperature: 0.1 // Low temperature for faithful translation
            })
        });
        if (res.ok) {
            const data = await res.json();
            return data.choices?.[0]?.message?.content || text;
        }
    } catch (e) {
        console.warn('[Translation] Translation failed, using source text:', e.message);
    }
    return text; // Fallback: use untranslated text for synthesis
}

// ==================================================
// LANGUAGE DETECTION (using Deepgram response)
// ==================================================
export function extractDetectedLanguage(deepgramResponse) {
    // Deepgram returns detected_language in the channel results
    return deepgramResponse?.results?.channels?.[0]?.detected_language || 'en';
}

// ==================================================
// UTILITY
// ==================================================
export function getLangLabel(code) {
    return SUPPORTED_LANGUAGES[code]?.label || code?.toUpperCase() || 'Unknown';
}

export function getLangFlag(code) {
    return SUPPORTED_LANGUAGES[code]?.flag || '🌐';
}

export function getDefaultOutputLanguage(region) {
    const map = { 'IN': 'en', 'US': 'en', 'UK': 'en', 'EU': 'en', 'GLOBAL': 'en' };
    return map[region] || 'en';
}
