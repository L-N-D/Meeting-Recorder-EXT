/**
 * Persists MediaRecorder chunks to Origin Private File System (OPFS)
 * so long recordings do not accumulate unbounded RAM usage.
 */
export class ChunkStorage {
  private rootDir: FileSystemDirectoryHandle | null = null;
  private sessionDir: FileSystemDirectoryHandle | null = null;
  private chunkCount = 0;
  private sessionId = '';

  async init(): Promise<void> {
    this.rootDir = await navigator.storage.getDirectory();
    this.sessionId = `session-${Date.now()}`;
    this.sessionDir = await this.rootDir.getDirectoryHandle(this.sessionId, { create: true });
    this.chunkCount = 0;
  }

  async appendChunk(chunk: Blob): Promise<void> {
    if (!this.sessionDir) {
      throw new Error('ChunkStorage not initialized');
    }

    const fileHandle = await this.sessionDir.getFileHandle(`${this.chunkCount}.bin`, {
      create: true,
    });
    const writable = await fileHandle.createWritable();
    await writable.write(chunk);
    await writable.close();
    this.chunkCount += 1;
  }

  async assembleBlob(mimeType: string): Promise<Blob> {
    if (!this.sessionDir || this.chunkCount === 0) {
      return new Blob([], { type: mimeType });
    }

    const parts: Blob[] = [];
    for (let i = 0; i < this.chunkCount; i += 1) {
      const fileHandle = await this.sessionDir.getFileHandle(`${i}.bin`);
      const file = await fileHandle.getFile();
      parts.push(file);
    }

    return new Blob(parts, { type: mimeType });
  }

  async cleanup(): Promise<void> {
    if (!this.sessionDir || !this.rootDir) {
      return;
    }

    for (let i = 0; i < this.chunkCount; i += 1) {
      try {
        await this.sessionDir.removeEntry(`${i}.bin`);
      } catch {
        // Ignore missing entries during cleanup
      }
    }

    try {
      await this.rootDir.removeEntry(this.sessionId, { recursive: true });
    } catch {
      // Ignore if directory removal is unsupported
    }

    this.sessionDir = null;
    this.chunkCount = 0;
    this.sessionId = '';
  }
}
