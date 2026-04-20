import { supabase } from './supabase_bundle.js';

const DB_NAME = 'prysmDB';
const DB_VERSION = 1;

// --- CLOUD SYNC HELPERS ---
export async function syncChunkToCloud(lectureId, chunkIndex, transcript) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  try {
    const data = {
        lecture_id: lectureId.toString(),
        user_id: user.id,
        chunk_index: parseInt(chunkIndex),
        transcript: transcript,
        created_at: new Date().toISOString()
    };
    await supabase.from('chunks').insert(data);
    console.log(`[DB] Synced chunk ${chunkIndex} for lecture ${lectureId} to Supabase.`);
  } catch (e) {
    console.warn("[DB] Chunk cloud sync failed:", e.message);
  }
}

async function syncLectureToCloud(lectureId, data) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  try {
    const mappedData = {
        id: lectureId.toString(),
        user_id: user.id,
        title: data.title || "Untitled Session",
        region: data.region || 'GLOBAL',
        status: data.status || "incomplete",
        updated_at: new Date().toISOString()
    };
    await supabase.from('lectures').upsert(mappedData);
    console.log(`[DB] Synced lecture ${lectureId} to Supabase.`);
  } catch (e) {
    console.warn("[DB] Cloud sync failed:", e.message);
  }
}

export function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains('lectures')) {
        const lectureStore = db.createObjectStore('lectures', { keyPath: 'id', autoIncrement: true });
        lectureStore.createIndex('status', 'status', { unique: false });
      }
      if (!db.objectStoreNames.contains('chunks')) {
        const chunkStore = db.createObjectStore('chunks', { keyPath: ['lectureId', 'chunkId'] });
        chunkStore.createIndex('lectureId', 'lectureId', { unique: false });
      }
      if (!db.objectStoreNames.contains('knowledge')) {
        db.createObjectStore('knowledge', { keyPath: 'lectureId' });
      }
      if (!db.objectStoreNames.contains('output')) {
        db.createObjectStore('output', { keyPath: 'lectureId' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// Ensure the DB is always ready
let dbPromise = null;
async function getDB() {
  if (!dbPromise) dbPromise = openDB();
  return dbPromise;
}

export async function addLecture(lecture) {
  const db = await openDB();
  // Start local save
  const localSave = new Promise((resolve, reject) => {
    const tx = db.transaction('lectures', 'readwrite');
    const store = tx.objectStore('lectures');
    const sanitizedLecture = { ...lecture, id: lecture.id.toString() };
    const req = store.add(sanitizedLecture);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  const result = await localSave;
  // Trigger async cloud sync
  if (lecture.id) syncLectureToCloud(lecture.id, lecture);
  return result;
}

export async function addChunk(chunk) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('chunks', 'readwrite');
    const store = tx.objectStore('chunks');
    const sanitizedChunk = { 
        ...chunk, 
        lectureId: chunk.lectureId.toString(), 
        chunkId: parseInt(chunk.chunkId) 
    };
    const req = store.put(sanitizedChunk);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function getLecture(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('lectures', 'readonly');
    const store = tx.objectStore('lectures');
    const req = store.get(id.toString());
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function updateLecture(id, updates) {
  const db = await openDB();
  const lecture = await getLecture(id);
  const updated = { ...lecture, ...updates };
  
  const localUpdate = new Promise((resolve, reject) => {
    const tx = db.transaction('lectures', 'readwrite');
    const store = tx.objectStore('lectures');
    const req = store.put(updated);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });

  await localUpdate;
  // Sync full updated lecture to cloud
  if (id) syncLectureToCloud(id, updated);
}

export async function addOutput(lectureId, output) {
  const db = await openDB();
  const data = { lectureId, ...output, updatedAt: Date.now() };
  
  const localSave = new Promise((resolve, reject) => {
    const tx = db.transaction('output', 'readwrite');
    const store = tx.objectStore('output');
    const req = store.put(data);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });

  await localSave;
  // Sync output to cloud
  const { data: { user } } = await supabase.auth.getUser();
  if (user) {
    try {
      const mappedOutput = {
          lecture_id: lectureId.toString(),
          user_id: user.id,
          title: output.title || null,
          summary: output.summary || null,
          summary_sheet: output.summary_sheet || null,
          analysis: output.analysis || null,
          history: output.history || null,
          tags: output.tags || [],
          mcqs: output.mcqs || [],
          flashcards: output.flashcards || [],
          glossary: output.glossary || [],
          updated_at: new Date().toISOString()
      };
      await supabase.from('outputs').upsert(mappedOutput);
      console.log(`[DB] Synced output for lecture ${lectureId} to Supabase.`);
    } catch (e) {
      console.warn("[DB] Cloud output sync failed:", e.message);
    }
  }
}

export async function getOutput(lectureId) {
  const db = await openDB();
  // First check local
  const localResult = await new Promise((resolve, reject) => {
    const tx = db.transaction('output', 'readonly');
    const store = tx.objectStore('output');
    const req = store.get(lectureId);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  if (localResult) return localResult;

  // Fallback to cloud
  const { data: { user } } = await supabase.auth.getUser();
  if (user) {
    try {
      const { data: cloudData, error } = await supabase
        .from('outputs')
        .select('*')
        .eq('lecture_id', lectureId.toString())
        .single();
        
      if (cloudData && !error) {
        // Save to local for future use
        const tx = db.transaction('output', 'readwrite');
        tx.objectStore('output').put({
            lectureId: cloudData.lecture_id,
            ...cloudData
        });
        return cloudData;
      }
    } catch (e) {
      console.warn("[DB] Cloud fetch failed:", e.message);
    }
  }
  return null;
}

// Additional helper functions for chunk operations and lecture queries

export async function getChunk(lectureId, chunkId) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('chunks', 'readonly');
    const store = tx.objectStore('chunks');
    const req = store.get([lectureId, chunkId]);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function updateChunk(lectureId, chunkId, updates) {
  const db = await openDB();
  const chunk = await getChunk(lectureId, chunkId);
  const updated = { ...chunk, ...updates };
  return new Promise((resolve, reject) => {
    const tx = db.transaction('chunks', 'readwrite');
    const store = tx.objectStore('chunks');
    const req = store.put(updated);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function addKnowledge(lectureId, knowledge) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('knowledge', 'readwrite');
    const store = tx.objectStore('knowledge');
    const getReq = store.get(lectureId);
    getReq.onsuccess = () => {
      const existing = getReq.result || { lectureId, points: [], concepts: [], terms: [], examples: [] };
      // Merge arrays
      existing.points = [...existing.points, ...(knowledge.points || [])];
      existing.concepts = [...existing.concepts, ...(knowledge.concepts || [])];
      existing.terms = [...existing.terms, ...(knowledge.terms || [])];
      existing.examples = [...existing.examples, ...(knowledge.examples || [])];
      const putReq = store.put(existing);
      putReq.onsuccess = () => resolve();
      putReq.onerror = () => reject(putReq.error);
    };
    getReq.onerror = () => reject(getReq.error);
  });
}

export async function getIncompleteLectures() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('lectures', 'readonly');
    const store = tx.objectStore('lectures');
    const index = store.index('status');
    const req = index.getAll('incomplete');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function getPendingChunks(lectureId) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('chunks', 'readonly');
    const store = tx.objectStore('chunks');
    const index = store.index('lectureId');
    const range = IDBKeyRange.only(lectureId);
    const req = index.getAll(range);
    req.onsuccess = () => {
      const pending = req.result.filter(c => !c.transcript);
      resolve(pending);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function getKnowledge(lectureId) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('knowledge', 'readonly');
    const store = tx.objectStore('knowledge');
    const req = store.get(lectureId);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function getFullTranscript(lectureId) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('chunks', 'readonly');
    const store = tx.objectStore('chunks');
    const index = store.index('lectureId');
    const range = IDBKeyRange.only(lectureId.toString());
    const req = index.getAll(range);
    req.onsuccess = () => {
      // Sort by chunkId to ensure chronological order
      const sorted = req.result.sort((a, b) => a.chunkId - b.chunkId);
      const transcript = sorted
        .map(c => c.transcript)
        .filter(t => {
            if (!t || t.trim().length < 2) return false;
            const up = t.toUpperCase();
            // Refined filter: Only discard actual errors or absolute silence, keep short conversational responses
            if (up.includes("[TRANSCRIPTION_ERROR]") || up === "SILENT" || up === "SILENCE") return false;
            return true;
        })
        .join(' ');
      resolve(transcript);
    };
    req.onerror = () => reject(req.error);
  });
}
