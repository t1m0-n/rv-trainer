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
 */
export class JournalStore {
  async saveSession(data) { throw new Error('Not implemented'); }
  async getAllSessions() { throw new Error('Not implemented'); }
  async getSession(id) { throw new Error('Not implemented'); }
  async updateSession(id, data) { throw new Error('Not implemented'); }
  async deleteSession(id) { throw new Error('Not implemented'); }
  async getStats() { throw new Error('Not implemented'); }
}

export class IndexedDBStore extends JournalStore {
  constructor() {
    super();
    this.dbName = 'rv-trainer';
    this.storeName = 'sessions';
    this.version = 1;
    this.db = null;
  }

  async open() {
    if (this.db) return this.db;
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(this.dbName, this.version);

      req.onupgradeneeded = e => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          const store = db.createObjectStore(this.storeName, { keyPath: 'id' });
          store.createIndex('startedAt', 'startedAt', { unique: false });
          store.createIndex('score', 'score', { unique: false });
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

  _transaction(mode) {
    const tx = this.db.transaction([this.storeName], mode);
    const store = tx.objectStore(this.storeName);
    return { tx, store };
  }

  _promisify(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = e => resolve(e.target.result);
      req.onerror = e => reject(e.target.error);
    });
  }

  async saveSession(data) {
    if (!data.id) throw new Error('Session muss eine ID haben');
    const { store } = this._transaction('readwrite');
    await this._promisify(store.put(data));
    return data.id;
  }

  async getAllSessions() {
    const { store } = this._transaction('readonly');
    const index = store.index('startedAt');
    const sessions = await this._promisify(index.getAll());
    // Sort descending (newest first)
    return sessions.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  async getSession(id) {
    const { store } = this._transaction('readonly');
    const session = await this._promisify(store.get(id));
    if (!session) throw new Error(`Session ${id} nicht gefunden`);
    return session;
  }

  async updateSession(id, updates) {
    const session = await this.getSession(id);
    const updated = { ...session, ...updates };
    const { store } = this._transaction('readwrite');
    await this._promisify(store.put(updated));
    return updated;
  }

  async deleteSession(id) {
    const { store } = this._transaction('readwrite');
    await this._promisify(store.delete(id));
  }

  async getStats() {
    const sessions = await this.getAllSessions();
    const totalSessions = sessions.length;

    if (totalSessions === 0) {
      return {
        totalSessions: 0,
        averageScore: null,
        bestScore: null,
        scoreDistribution: {},
      };
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
}
