export function indexedDBDraftStore(indexedDB) {
  let pending;
  const open = () => pending ||= new Promise((resolve, reject) => {
    if (!indexedDB) { reject(new Error('IndexedDB unavailable')); return; }
    const request = indexedDB.open('spriteforge3d-projects', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('drafts');
    request.onerror = () => { pending = null; reject(request.error); };
    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => { database.close(); pending = null; };
      resolve(database);
    };
  });
  return {
    async read() {
      const database = await open();
      return new Promise((resolve, reject) => {
        const transaction = database.transaction('drafts'); const request = transaction.objectStore('drafts').get('latest');
        request.onsuccess = () => resolve(request.result || null); request.onerror = () => reject(request.error);
        transaction.onabort = () => reject(transaction.error || new Error('Draft read aborted'));
      });
    },
    async write(record) {
      const database = await open();
      return new Promise((resolve, reject) => {
        const transaction = database.transaction('drafts', 'readwrite'); transaction.objectStore('drafts').put(record, 'latest');
        transaction.oncomplete = () => resolve(); transaction.onerror = transaction.onabort = () => reject(transaction.error || new Error('Draft write aborted'));
      });
    },
  };
}

export class ProjectAutosave {
  constructor({ storage, durable, key = 'spriteforge3d.autosave.v1' }) {
    Object.assign(this, { storage, durable, key }); this.queue = Promise.resolve(); this.sequence = 0;
  }

  local() {
    let raw;
    try { raw = this.storage?.getItem(this.key); } catch { return null; }
    if (!raw) return null;
    try {
      const document = JSON.parse(raw); const savedAt = Number(document.savedAt) || 0;
      return document.spriteforgeAutosave === 'indexedDB' ? { savedAt, marker: true } : { savedAt, json: raw };
    } catch { return { savedAt: Infinity, json: raw }; } // Preserve a corrupt draft for explicit recovery.
  }

  async read() {
    await this.queue.catch(() => {});
    const local = this.local(); let durable;
    try { durable = await this.durable.read(); }
    catch (error) { if (!local?.json) throw error; }
    if (durable && (typeof durable.json !== 'string' || !Number.isFinite(durable.savedAt))) throw new Error('Invalid saved draft record');
    if (local?.marker && (!durable || durable.savedAt < local.savedAt)) throw new Error('The saved draft could not be recovered from IndexedDB');
    return local?.json && (!durable || local.savedAt >= durable.savedAt) ? local.json : durable?.json || null;
  }

  save(document) {
    const record = { savedAt: document.savedAt || Date.now(), json: JSON.stringify(document) };
    const sequence = ++this.sequence; let fallback = false;
    if (record.json.length <= 1000000) {
      try { this.storage.setItem(this.key, record.json); fallback = true; } catch { /* IndexedDB remains available when localStorage is full. */ }
    }
    const write = async () => {
      try {
        await this.durable.write(record);
        if (sequence === this.sequence && !fallback) {
          try { this.storage.setItem(this.key, JSON.stringify({ spriteforgeAutosave: 'indexedDB', savedAt: record.savedAt })); } catch { /* The durable copy is authoritative. */ }
        }
        return 'indexedDB';
      } catch (error) { if (!fallback) throw error; return 'localStorage'; }
    };
    this.queue = this.queue.catch(() => {}).then(write); return this.queue;
  }
}
