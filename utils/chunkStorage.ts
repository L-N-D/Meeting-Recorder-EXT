/**
 * Persists MediaRecorder chunks to IndexedDB (local browser disk storage)
 * so long recordings do not accumulate unbounded RAM usage, avoiding the
 * limitations and bugs associated with OPFS createWritable in MV3 offscreen documents.
 */
export class ChunkStorage {
  private db: IDBDatabase | null = null;
  private sessionId = '';
  private chunkCount = 0;

  private DB_NAME = 'RecordExtensionDB';
  private STORE_NAME = 'chunks';

  async init(): Promise<void> {
    this.sessionId = `session-${Date.now()}`;
    this.chunkCount = 0;

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.DB_NAME, 1);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(this.STORE_NAME)) {
          db.createObjectStore(this.STORE_NAME);
        }
      };

      request.onsuccess = () => {
        this.db = request.result;
        console.log('[chunkStorage] IndexedDB opened, session:', this.sessionId);
        resolve();
      };

      request.onerror = () => {
        console.error('[chunkStorage] failed to open IndexedDB:', request.error);
        reject(request.error || new Error('Failed to open IndexedDB'));
      };
    });
  }

  async appendChunk(chunk: Blob): Promise<void> {
    if (!this.db) {
      throw new Error('ChunkStorage not initialized');
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(this.STORE_NAME, 'readwrite');
      const store = transaction.objectStore(this.STORE_NAME);
      const key = `${this.sessionId}-${this.chunkCount}`;
      const request = store.put(chunk, key);

      transaction.oncomplete = () => {
        this.chunkCount += 1;
        resolve();
      };

      transaction.onerror = () => {
        reject(transaction.error || new Error(`Failed to save chunk ${this.chunkCount}`));
      };
    });
  }

  async assembleBlob(mimeType: string): Promise<Blob> {
    if (!this.db || this.chunkCount === 0) {
      return new Blob([], { type: mimeType });
    }

    const parts: Blob[] = [];

    for (let i = 0; i < this.chunkCount; i += 1) {
      const chunk = await this.getChunk(i);
      if (chunk) {
        parts.push(chunk);
      }
    }

    return new Blob(parts, { type: mimeType });
  }

  private getChunk(index: number): Promise<Blob | null> {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        return resolve(null);
      }

      const transaction = this.db.transaction(this.STORE_NAME, 'readonly');
      const store = transaction.objectStore(this.STORE_NAME);
      const key = `${this.sessionId}-${index}`;
      const request = store.get(key);

      request.onsuccess = () => {
        resolve(request.result || null);
      };

      request.onerror = () => {
        reject(request.error || new Error(`Failed to read chunk ${index}`));
      };
    });
  }

  async cleanup(): Promise<void> {
    if (!this.db) {
      return;
    }

    return new Promise((resolve) => {
      const transaction = this.db!.transaction(this.STORE_NAME, 'readwrite');
      const store = transaction.objectStore(this.STORE_NAME);

      for (let i = 0; i < this.chunkCount; i += 1) {
        const key = `${this.sessionId}-${i}`;
        try {
          store.delete(key);
        } catch (err) {
          console.warn(`Failed to schedule deletion for key ${key}:`, err);
        }
      }

      transaction.oncomplete = () => {
        this.db?.close();
        this.db = null;
        this.chunkCount = 0;
        this.sessionId = '';
        resolve();
      };

      transaction.onerror = (event) => {
        console.warn('Error during chunk cleanup:', event);
        this.db?.close();
        this.db = null;
        this.chunkCount = 0;
        this.sessionId = '';
        resolve();
      };
    });
  }
}
