import { auth, db as firestore, doc, setDoc, getDoc, updateDoc, collection, query, where, getDocs } from './firebase_config.js';

const DB_NAME = 'prysmDB';
const DB_VERSION = 1;

// --- CLOUD SYNC HELPERS ---
async function syncLectureToCloud(lectureId, data) {
  if (!auth.currentUser) return;
  try {
    const userRef = doc(firestore, 'users', auth.currentUser.uid);
    const lectureRef = doc(userRef, 'lectures', lectureId.toString());
    await setDoc(lectureRef, {
      ...data,
      updatedAt: Date.now()
    }, { merge: true });
    console.log(`[DB] Synced lecture ${lectureId} to cloud.`);
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

export async function addLecture(lecture) {
  const db = await openDB();
  // Start local save
  const localSave = new Promise((resolve, reject) => {
    const tx = db.transaction('lectures', 'readwrite');
    const store = tx.objectStore('lectures');
    const req = store.add(lecture);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  const result = await localSave;
  // Trigger async cloud sync
  syncLectureToCloud(lecture.id, lecture);
  return result;
}

export async function addChunk(chunk) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('chunks', 'readwrite');
    const store = tx.objectStore('chunks');
    const req = store.put(chunk);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function getLecture(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('lectures', 'readonly');
    const store = tx.objectStore('lectures');
    const req = store.get(id);
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
  syncLectureToCloud(id, updated);
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
    const range = IDBKeyRange.only(lectureId);
    const req = index.getAll(range);
    req.onsuccess = () => {
      // Sort by chunkId to ensure chronological order
      const sorted = req.result.sort((a, b) => a.chunkId - b.chunkId);
      const transcript = sorted
        .map(c => c.transcript)
        .filter(t => t && t !== "[TRANSCRIPTION_ERROR]" && t !== "[SILENT_AUDIO]")
        .join(' ');
      resolve(transcript);
    };
    req.onerror = () => reject(req.error);
  });
}
