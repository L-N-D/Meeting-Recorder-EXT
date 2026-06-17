import { ChunkStorage } from './chunkStorage';
import { fixWebmDuration } from './webmDurationFix';

/**
 * Helper class to manage the MediaRecorder lifecycle, chunk collection,
 * and media track cleanup.
 */
export class ScreenRecorder {
  private mediaRecorder: MediaRecorder | null = null;
  private chunkStorage = new ChunkStorage();
  private onBlobReady: (blob: Blob) => void;
  private onTimeUpdate: (seconds: number) => void;
  private onError: (error: Error) => void;
  private onStateChange: (state: 'recording' | 'paused') => void;

  private startTime = 0;
  private pausedAt = 0;
  private totalPausedMs = 0;
  private timerInterval: ReturnType<typeof setInterval> | null = null;
  private tracksToCleanup: MediaStreamTrack[] = [];
  private audioContextToCleanup: AudioContext | null = null;
  private recordedMimeType = 'video/webm';
  private pendingChunkWrites: Promise<void>[] = [];
  private stopResolve: (() => void) | null = null;

  constructor(options: {
    onBlobReady: (blob: Blob) => void;
    onTimeUpdate: (seconds: number) => void;
    onError: (error: Error) => void;
    onStateChange?: (state: 'recording' | 'paused') => void;
  }) {
    this.onBlobReady = options.onBlobReady;
    this.onTimeUpdate = options.onTimeUpdate;
    this.onError = options.onError;
    this.onStateChange = options.onStateChange ?? (() => undefined);
  }

  public async start(
    stream: MediaStream,
    additionalTracks: MediaStreamTrack[] = [],
    audioContext: AudioContext | null = null
  ): Promise<void> {
    this.tracksToCleanup = [...stream.getTracks(), ...additionalTracks];
    this.audioContextToCleanup = audioContext;
    this.startTime = Date.now();
    this.pausedAt = 0;
    this.totalPausedMs = 0;

    try {
      await this.chunkStorage.init();
    } catch (err) {
      this.onError(new Error(`Failed to initialize chunk storage: ${(err as Error).message}`));
      this.cleanup();
      return;
    }

    const candidates = [
      'video/mp4;codecs=h264,aac',
      'video/mp4;codecs=h264,opus',
      'video/mp4',
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm',
    ];

    let selectedType = '';
    for (const candidate of candidates) {
      if (MediaRecorder.isTypeSupported(candidate)) {
        selectedType = candidate;
        break;
      }
    }

    try {
      const options = selectedType ? { mimeType: selectedType } : {};
      this.mediaRecorder = new MediaRecorder(stream, options);
      this.recordedMimeType = this.mediaRecorder.mimeType || selectedType || 'video/webm';
    } catch {
      try {
        this.mediaRecorder = new MediaRecorder(stream);
        this.recordedMimeType = this.mediaRecorder.mimeType || 'video/webm';
      } catch (fallbackErr: any) {
        this.onError(new Error(`Failed to initialize MediaRecorder: ${fallbackErr.message}`));
        await this.chunkStorage.cleanup();
        this.cleanup();
        return;
      }
    }

    this.pendingChunkWrites = [];

    let chunkCount = 0;
    this.mediaRecorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        chunkCount += 1;
        console.log('[recorder] chunk', chunkCount, 'size:', event.data.size);
        const write = this.chunkStorage.appendChunk(event.data).catch((storageErr) => {
          console.error('[recorder] failed to persist chunk to IndexedDB:', storageErr);
          this.onError(new Error('Failed to persist recording chunk'));
          void this.stop();
        });
        this.pendingChunkWrites.push(write);
      } else {
        console.warn('[recorder] dataavailable fired with empty data');
      }
    };

    this.mediaRecorder.onstop = () => {
      void this.finalizeRecording();
    };

    this.mediaRecorder.onerror = (event: any) => {
      console.error('[recorder] MediaRecorder error:', event.error);
      this.onError(event.error || new Error('MediaRecorder encountered an error'));
      void this.chunkStorage.cleanup();
      this.cleanup();
    };

    this.mediaRecorder.start(250);
    console.log('[recorder] MediaRecorder started, mime:', this.recordedMimeType, 'state:', this.mediaRecorder.state);
    this.onStateChange('recording');

    this.timerInterval = setInterval(() => {
      const elapsedSeconds = Math.floor(this.getElapsedMs() / 1000);
      this.onTimeUpdate(elapsedSeconds);
    }, 1000);
  }

  public pause(): void {
    if (this.mediaRecorder?.state === 'recording') {
      this.mediaRecorder.pause();
      this.pausedAt = Date.now();
      this.onStateChange('paused');
    }
  }

  public resume(): void {
    if (this.mediaRecorder?.state === 'paused') {
      this.mediaRecorder.resume();
      if (this.pausedAt > 0) {
        this.totalPausedMs += Date.now() - this.pausedAt;
        this.pausedAt = 0;
      }
      this.onStateChange('recording');
    }
  }

  public stop(): Promise<void> {
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      return new Promise((resolve) => {
        this.stopResolve = resolve;
        try {
          if (this.mediaRecorder!.state === 'recording') {
            this.mediaRecorder!.requestData();
          }
          this.mediaRecorder!.stop();
        } catch (err) {
          this.stopResolve = null;
          resolve();
          throw err;
        }
      });
    }

    void this.chunkStorage.cleanup();
    this.cleanup();
    return Promise.resolve();
  }

  public cleanup(): void {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }

    this.tracksToCleanup.forEach((track) => {
      try {
        if (track.readyState !== 'ended') {
          track.stop();
        }
      } catch (err) {
        console.error('Failed to stop media track', err);
      }
    });
    this.tracksToCleanup = [];

    if (this.audioContextToCleanup) {
      try {
        if (this.audioContextToCleanup.state !== 'closed') {
          this.audioContextToCleanup.close();
        }
      } catch (err) {
        console.error('Failed to close AudioContext', err);
      }
      this.audioContextToCleanup = null;
    }

    this.mediaRecorder = null;
  }

  private getElapsedMs(): number {
    let pausedMs = this.totalPausedMs;
    if (this.pausedAt > 0) {
      pausedMs += Date.now() - this.pausedAt;
    }
    return Math.max(0, Date.now() - this.startTime - pausedMs);
  }

  private async finalizeRecording(): Promise<void> {
    const mimeType = this.recordedMimeType;
    const durationMs = this.getElapsedMs();

    try {
      await Promise.all(this.pendingChunkWrites);
      this.pendingChunkWrites = [];

      let finalBlob = await this.chunkStorage.assembleBlob(mimeType);
      if (finalBlob.size === 0) {
        this.onError(
          new Error('Recording is empty. Keep recording for at least a few seconds before stopping.')
        );
        return;
      }

      finalBlob = await fixWebmDuration(finalBlob, durationMs);
      this.onBlobReady(finalBlob);
    } catch (err) {
      this.onError(new Error(`Failed to finalize recording: ${(err as Error).message}`));
    } finally {
      await this.chunkStorage.cleanup();
      this.cleanup();
      this.stopResolve?.();
      this.stopResolve = null;
    }
  }
}
