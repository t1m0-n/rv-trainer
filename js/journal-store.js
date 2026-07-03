/**
 * JournalStore — abstract interface for session persistence.
 *
 * Session data shape:
 * {
 *   id: string (UUID),
 *   coordinate: string,
 *   startedAt: ISO string,
 *   endedAt: ISO string,
 *   durationSeconds: number,
 *   score: number (0-5),
 *   notes: string,
 *   targetBlob: Blob,
 *   targetMetadata: object,
 *   notePhotos: Blob[]
 * }
 *
 * ARV Trial data shape:
 * {
 *   id: string,
 *   type: 'arv',
 *   status: 'setup' | 'session_done' | 'judged' | 'resolved',
 *   createdAt: ISO string,
 *   question: string,
 *   outcome1: string,
 *   outcome2: string,
 *   feedbackAt: ISO string,
 *   coordinate: string,
 *   imageABlob: Blob | null,
 *   imageBBlob: Blob | null,
 *   encryptedAssignment: ArrayBuffer | null,
 *   assignmentIv: Uint8Array | null,
 *   sessionStartedAt: ISO string | null,
 *   sessionEndedAt: ISO string | null,
 *   durationSeconds: number | null,
 *   notePhotos: Blob[],
 *   judgeResult: { pickedImage, confidence, reasoning } | null,
 *   actualOutcome: '1' | '2' | null,
 *   resolvedAt: ISO string | null,
 *   resolvedImageBlob: Blob | null,
 *   hit: boolean | null,
 * }
 */
export class JournalStore {
  async saveSession(data) { throw new Error('Not implemented'); }
  async getAllSessions() { throw new Error('Not implemented'); }
  async getSession(id) { throw new Error('Not implemented'); }
  async updateSession(id, data) { throw new Error('Not implemented'); }
  async deleteSession(id) { throw new Error('Not implemented'); }
  async getStats() { throw new Error('Not implemented'); }

  // ARV
  async saveArvTrial(data) { throw new Error('Not implemented'); }
  async getAllArvTrials() { throw new Error('Not implemented'); }
  async getArvTrial(id) { throw new Error('Not implemented'); }
  async updateArvTrial(id, updates) { throw new Error('Not implemented'); }
  async deleteArvTrial(id) { throw new Error('Not implemented'); }
}

export class IndexedDBStore extends JournalStore {
  constructor() {
    super();
    this.dbName = 'rv-trainer';
    this.storeName = 'sessions';
    this.arvStoreName = 'arv-trials';
    this.version = 2;
    this.db = null;
  }

  async open() {
    if (this.db) return this.db;
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(this.dbName, this.version);

      req.onupgradeneeded = e => {
        const db = e.target.result;
        const oldVersion = e.oldVersion;

        // v1: sessions store
        if (oldVersion < 1) {
          if (!db.objectStoreNames.contains(this.storeName)) {
            const store = db.createObjectStore(this.storeName, { keyPath: 'id' });
            store.createIndex('startedAt', 'startedAt', { unique: false });
            store.createIndex('score', 'score', { unique: false });
          }
        }

        // v2: arv-trials store
        if (oldVersion < 2) {
          if (!db.objectStoreNames.contains(this.arvStoreName)) {
            const arvStore = db.createObjectStore(this.arvStoreName, { keyPath: 'id' });
            arvStore.createIndex('createdAt', 'createdAt', { unique: false });
            arvStore.createIndex('feedbackAt', 'feedbackAt', { unique: false });
            arvStore.createIndex('status', 'status', { unique: false });
          }
        }
      };

      req.onsuccess = e => {
        this.db = e.target.result;
        resolve(this.db);
      };

      req.onerror = e => reject(new Error(`IndexedDB Fehler: ${e.target.error?.message}`));
      req.onblocked = () => reject(new Error('IndexedDB blockiert – bitte alle Tabs schließen.'));
    });
  }

  _transaction(storeNames, mode) {
    const names = Array.isArray(storeNames) ? storeNames : [storeNames];
    const tx = this.db.transaction(names, mode);
    if (names.length === 1) {
      return { tx, store: tx.objectStore(names[0]) };
    }
    return { tx, stores: names.reduce((acc, n) => { acc[n] = tx.objectStore(n); return acc; }, {}) };
  }

  _promisify(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = e => resolve(e.target.result);
      req.onerror = e => reject(e.target.error);
    });
  }

  // ── Sessions ─────────────────────────────────────────────────────

  async saveSession(data) {
    if (!data.id) throw new Error('Session muss eine ID haben');
    const { store } = this._transaction(this.storeName, 'readwrite');
    await this._promisify(store.put(data));
    return data.id;
  }

  async getAllSessions() {
    const { store } = this._transaction(this.storeName, 'readonly');
    const index = store.index('startedAt');
    const sessions = await this._promisify(index.getAll());
    return sessions.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  async getSession(id) {
    const { store } = this._transaction(this.storeName, 'readonly');
    const session = await this._promisify(store.get(id));
    if (!session) throw new Error(`Session ${id} nicht gefunden`);
    return session;
  }

  async updateSession(id, updates) {
    const session = await this.getSession(id);
    const updated = { ...session, ...updates };
    const { store } = this._transaction(this.storeName, 'readwrite');
    await this._promisify(store.put(updated));
    return updated;
  }

  async deleteSession(id) {
    const { store } = this._transaction(this.storeName, 'readwrite');
    await this._promisify(store.delete(id));
  }

  async getStats() {
    const sessions = await this.getAllSessions();
    const totalSessions = sessions.length;

    if (totalSessions === 0) {
      return { totalSessions: 0, averageScore: null, bestScore: null, scoreDistribution: {} };
    }

    const scoredSessions = sessions.filter(s => s.score != null && s.score > 0);
    const averageScore = scoredSessions.length > 0
      ? scoredSessions.reduce((sum, s) => sum + s.score, 0) / scoredSessions.length
      : null;
    const bestScore = scoredSessions.length > 0
      ? Math.max(...scoredSessions.map(s => s.score))
      : null;
    const scoreDistribution = {};
    for (let i = 0; i <= 5; i++) scoreDistribution[i] = 0;
    sessions.forEach(s => {
      if (s.score != null) scoreDistribution[s.score] = (scoreDistribution[s.score] || 0) + 1;
    });

    return { totalSessions, averageScore, bestScore, scoreDistribution };
  }

  // ── ARV Trials ────────────────────────────────────────────────────

  async saveArvTrial(data) {
    if (!data.id) throw new Error('ARV-Trial muss eine ID haben');
    const { store } = this._transaction(this.arvStoreName, 'readwrite');
    await this._promisify(store.put(data));
    return data.id;
  }

  async getAllArvTrials() {
    const { store } = this._transaction(this.arvStoreName, 'readonly');
    const index = store.index('createdAt');
    const trials = await this._promisify(index.getAll());
    return trials.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async getArvTrial(id) {
    const { store } = this._transaction(this.arvStoreName, 'readonly');
    const trial = await this._promisify(store.get(id));
    if (!trial) throw new Error(`ARV-Trial ${id} nicht gefunden`);
    return trial;
  }

  async updateArvTrial(id, updates) {
    const trial = await this.getArvTrial(id);
    const updated = { ...trial, ...updates };
    const { store } = this._transaction(this.arvStoreName, 'readwrite');
    await this._promisify(store.put(updated));
    return updated;
  }

  async deleteArvTrial(id) {
    const { store } = this._transaction(this.arvStoreName, 'readwrite');
    await this._promisify(store.delete(id));
  }
}
