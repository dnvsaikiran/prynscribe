// lib/ai_service.js
// FINAL STABLE PRODUCTION: Dual-Core Pipeline

async function getApiKeys() {
    const data = await chrome.storage.local.get(['deepgram_api_key', 'groq_api_key', 'gemini_api_key']);
    const keys = {
        deepgram: data.deepgram_api_key || '',
        groq: data.groq_api_key || '', 
        gemini: data.gemini_api_key || ''
    };
    
    // Check if keys are missing
    if (!keys.deepgram && !keys.groq) {
        console.error("[AI Service] API Keys missing. Please set them in the configuration.");
    }
    
    return keys;
}

async function callLLM(prompt, provider = 'groq', modelPref = null, systemPrompt = "") {
    const keys = await getApiKeys();
    let url, key, model;

    switch (provider) {
        case 'gemini':
            // Use Google's native OpenAI-compatible endpoint
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

    if (!key) throw new Error(`${provider.toUpperCase()} API Key is missing. Check settings.`);

    const messages = [];
    if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
    
    // Groq JSON enforcement: The word 'json' MUST appear in the messages
    const finalPrompt = provider === 'groq' ? `${prompt}\n\nIMPORTANT: Return the response in valid JSON format.` : prompt;
    messages.push({ role: 'user', content: finalPrompt });

    let attempts = 0;
    const maxRetries = 2;

    while (attempts < maxRetries) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 60000);

            const headers = { 'Content-Type': 'application/json' };
            if (provider === 'groq') {
                headers['Authorization'] = `Bearer ${key}`;
            }
            // Gemini doesn't use Bearer token in headers for this endpoint, it's in the URL query param

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
            if (!response.ok) {
                const errText = await response.text();
                console.error(`[AI Service] callLLM Error (${provider}): ${response.status} - ${errText}`);
                throw new Error(`AI Gateway Error (${provider}): ${response.status} ${response.statusText}`);
            }

            const data = await response.json();
            const content = data.choices[0].message.content;
            console.log(`[AI Service] callLLM Success (${provider})`);
            return content;
        } catch (e) {
            attempts++;
            console.warn(`[AI Service] callLLM attempt ${attempts} failed (${provider}):`, e.message);
            if (attempts >= maxRetries) throw e;
            await new Promise(r => setTimeout(r, 2000));
        }
    }
}

// User's mandated robust JSON extractor
function cleanAndExtractJson(text) {
    try {
        // Remove markdown code blocks if present
        let clean = text.replace(/```json/g, "").replace(/```/g, "").trim();
        
        const firstBrace = clean.indexOf("{");
        const lastBrace = clean.lastIndexOf("}");
        
        if (firstBrace === -1 || lastBrace === -1) {
            console.error("No JSON braces found in response:", text);
            return {};
        }

        clean = clean.substring(firstBrace, lastBrace + 1);
        return JSON.parse(clean);
    } catch (e) {
        console.error("JSON Parse failed. Raw text:", text);
        return {};
    }
}

// --- STEP 1: CHUNK PROCESSING (GROQ 8B) ---
export async function processTranscriptChunk(chunkText) {
    if (!chunkText || chunkText.trim().length < 50) {
        return { topics: [], key_points: [], definitions: [], examples: [], important_lines: [] };
    }

    // Heuristic for garbage/hallucinated transcripts
    const garbagePatterns = ["APPLAUSE", "Thank you for watching", "Subscribed", "Please subscribe", "Transcribed by"];
    const lowercaseText = chunkText.toLowerCase();
    const matches = garbagePatterns.filter(p => lowercaseText.includes(p.toLowerCase()));
    if (matches.length > 2 || chunkText.length < 20) {
        console.warn("[AI Service] Skipping likely garbage/hallucinated chunk.");
        return { topics: [], key_points: [], definitions: [], examples: [], important_lines: [] };
    }

    const prompt = `You are an academic note-making engine for competitive exams.

You will receive a lecture transcript chunk.
Your job is to extract high-yield academic content relevant for competitive examinations (like JEE, NEET, UPSC, CA, SSC).

IMPORTANT RULES:
- Return ONLY valid JSON
- No conversational filler
- Focus on conceptual clarity, formulas, dates, names, and key theories
- If no academic content is found, return empty arrays

OUTPUT FORMAT:
{
  "topics": ["Major theme"],
  "key_points": ["Specific factual or conceptual point"],
  "definitions": [{"term": "Concept", "meaning": "Explanation"}],
  "examples": ["Case studies, problems, or real-world examples"],
  "important_lines": ["Quotes or critical exam-ready statements"]
}

INPUT TRANSCRIPT:
${chunkText}`;

    const result = await callLLM(prompt, 'groq', 'llama-3.1-8b-instant');
    return cleanAndExtractJson(result);
}

// --- STEP 2A: CORE NOTES GENERATION (GROQ 70B with GEMINI Fallback) ---
export async function genCoreNotes(combinedData) {
    if (!combinedData || combinedData.length === 0) {
        return { title: "Insufficient Data", summary: "Transcript was too short or low quality for analysis.", key_points: [], glossary: [], mindmap_data: { nodes: [], links: [] } };
    }

    const prompt = `You are a Senior Academic Content Creator for competitive exams.
You will receive structured knowledge blocks extracted from a lecture.
Your task is to synthesize these into a "Master Study Sheet" and a "Concept Mindmap" suitable for exam preparation.

STRATEGIC GUIDELINES:
1. TITLE: Professional and descriptive based strictly on the input data.
2. SUMMARY: Comprehensive and academic. Use the Intro-Body-Conclusion format.
3. MINDMAP: Generate a hierarchical mindmap of the core concepts.
   - Nodes: { "id": "unique_id", "label": "Short Label", "level": 0 (Root) | 1 (Major) | 2 (Sub) }
   - Links: { "source": "parent_id", "target": "child_id" }

IMPORTANT: Do NOT hallucinate topics. Stick strictly to the input academic content.

OUTPUT FORMAT:
{
  "title": "",
  "tags": ["#ExamPrep", "#Academic"],
  "summary": "Detailed structured summary with key concepts...",
  "key_points": ["Point 1", "Point 2"],
  "glossary": [{"term": "", "meaning": ""}],
  "mindmap_data": {
    "nodes": [{"id": "root", "label": "Topic", "level": 0}],
    "links": []
  }
}

INPUT DATA:
${JSON.stringify(combinedData)}`;

    try {
        console.log("[AI Service] Attempting genCoreNotes with Groq...");
        const result = await callLLM(prompt, 'groq', 'llama-3.3-70b-versatile');
        return cleanAndExtractJson(result);
    } catch (e) {
        console.warn("[AI Service] genCoreNotes Groq failed, falling back to Gemini:", e.message);
        const result = await callLLM(prompt, 'gemini', 'gemini-1.5-flash');
        return cleanAndExtractJson(result);
    }
}

// --- STEP 2B: EXAM-READY MCQ GENERATION (GROQ 8B) ---
export async function genUPSCQs(combinedData) {
    const prompt = `You are a Competitive Exam Examiner (JEE, NEET, UPSC, CA, SSC).
Based on the provided academic data, generate 10 high-quality multiple-choice questions.

GUIDELINES:
1. Mix of factual and conceptual questions.
2. Provide clear explanations for each answer.
3. Questions should be exam-standard.

OUTPUT FORMAT:
[
  {
    "question": "",
    "options": ["A", "B", "C", "D"],
    "answer": 0,
    "explanation": ""
  }
]

INPUT DATA:
${JSON.stringify(combinedData)}`;

    const result = await callLLM(prompt, 'groq', 'llama-3.1-8b-instant');
    return cleanAndExtractJson(result);
}

// --- DEEPGRAM TRANSCRIPTION ---
export async function transcribeChunk(audioBase64, mode = 'exam') {
  const { groq, deepgram } = await getApiKeys();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 35000);

  // Whisper Prompting for better academic context
  let academicPrompt = "Academic lecture transcription.";
  if (mode === 'exam') academicPrompt = "Competitive exam study lecture (JEE, NEET, UPSC, CA, SSC). Focus on academic terminology, definitions, and key concepts.";
  else if (mode === 'hacker') academicPrompt = "Technical programming and computer science talk.";

  try {
      if (!audioBase64 || !audioBase64.includes(',')) throw new Error("Invalid Base64 Chunk");
      
      // Manual base64 to Blob conversion for maximum reliability in Service Worker
      const base64Data = audioBase64.split(',')[1];
      const mimeType = audioBase64.split(';')[0].split(':')[1] || 'audio/webm';
      const extension = mimeType.includes('wav') ? 'wav' : 'webm';
      
      const binaryData = atob(base64Data);
      const bytes = new Uint8Array(binaryData.length);
      for (let i = 0; i < binaryData.length; i++) {
          bytes[i] = binaryData.charCodeAt(i);
      }
      const audioBlob = new Blob([bytes], { type: mimeType });
      
      if (audioBlob.size < 5000) { 
          console.warn(`[AI Service] Chunk too small (${audioBlob.size} bytes), skipping.`);
          return "";
      }

      // --- PRIMARY: GROQ WHISPER ---
      try {
          console.log(`[AI Service] Attempting Groq Whisper (${(audioBlob.size/1024).toFixed(1)} KB) - Format: ${extension}...`);
          const formData = new FormData();
          const file = new File([audioBlob], `chunk_${Date.now()}.${extension}`, { type: mimeType });
          formData.append('file', file);
          formData.append('model', 'whisper-large-v3');
          formData.append('language', 'en');
          formData.append('response_format', 'json');
          formData.append('prompt', academicPrompt);

          const groqResponse = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
              method: 'POST',
              signal: controller.signal,
              headers: { 'Authorization': `Bearer ${groq}` },
              body: formData
          });

          if (groqResponse.ok) {
              const data = await groqResponse.json();
              console.log("[AI Service] Groq Success");
              return data.text || "";
          } else {
              const err = await groqResponse.text();
              console.warn(`[AI Service] Groq failed (${groqResponse.status}): ${err}`);
          }
      } catch (e) {
          console.warn("[AI Service] Groq error:", e);
      }

      // --- FALLBACK: DEEPGRAM ---
      console.log("[AI Service] Attempting Deepgram Fallback...");
      const response = await fetch('https://api.deepgram.com/v1/listen?smart_format=true&language=en-US&model=nova-2', {
        method: 'POST',
        signal: controller.signal,
        headers: { 
            'Authorization': `Token ${deepgram}`, 
            'Content-Type': mimeType 
        },
        body: audioBlob
      });
      
      if (!response.ok) {
          const errText = await response.text();
          console.error(`[AI Service] Deepgram failed (${response.status}): ${errText}`);
          throw new Error(`Transcription engines failed: ${response.status}`);
      }
      
      const data = await response.json();
      const transcript = data.results?.channels?.[0]?.alternatives?.[0]?.transcript;
      console.log("[AI Service] Deepgram Success");
      return transcript || "";
  } catch (e) {
      console.error("[AI Service] Transcription total failure:", e);
      throw e;
  } finally {
      clearTimeout(timeoutId);
  }
}

export async function askLectureBot(query, transcript, history) {
    const prompt = `User Query: ${query}\nHistory: ${JSON.stringify(history)}\nTranscript: ${transcript.substring(0, 10000)}`;
    return await callLLM(prompt, 'groq', 'llama-3.3-70b-versatile', "You are the PrynScribe Neural Consultant. Answer based on the lecture.");
}
