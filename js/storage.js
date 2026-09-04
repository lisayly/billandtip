// Persistence: IndexedDB holds the recorded audio blobs (own voice), localStorage
// holds the small per-word stats used to quietly bias repetition. Everything is
// local to the device — nothing ever leaves it.

const DB_NAME = 'toddler-lang-app';
const DB_VERSION = 1;
const STORE_RECORDINGS = 'recordings';
const STATS_KEY = 'wordStats.v1';

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_RECORDINGS)) {
        db.createObjectStore(STORE_RECORDINGS);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function recordingKey(wordId, langKey) {
  return `${wordId}:${langKey}`;
}

const Storage = {
  async saveRecording(wordId, langKey, blob) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_RECORDINGS, 'readwrite');
      tx.objectStore(STORE_RECORDINGS).put(blob, recordingKey(wordId, langKey));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },

  async deleteRecording(wordId, langKey) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_RECORDINGS, 'readwrite');
      tx.objectStore(STORE_RECORDINGS).delete(recordingKey(wordId, langKey));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },

  async getRecording(wordId, langKey) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_RECORDINGS, 'readonly');
      const req = tx.objectStore(STORE_RECORDINGS).get(recordingKey(wordId, langKey));
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  },

  async listRecordedKeys() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_RECORDINGS, 'readonly');
      const req = tx.objectStore(STORE_RECORDINGS).getAllKeys();
      req.onsuccess = () => resolve(new Set(req.result));
      req.onerror = () => reject(req.error);
    });
  },

  // --- stats (localStorage, tiny JSON) ---

  loadStats() {
    try {
      return JSON.parse(localStorage.getItem(STATS_KEY)) || {};
    } catch {
      return {};
    }
  },

  saveStats(stats) {
    try {
      localStorage.setItem(STATS_KEY, JSON.stringify(stats));
    } catch {
      // storage full/unavailable — stats just won't persist this session
    }
  },

  resetStats() {
    try {
      localStorage.removeItem(STATS_KEY);
    } catch { /* ignore */ }
  },
};
