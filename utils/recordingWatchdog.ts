export type RecordingWatchdogEvent = 'RECORDER_STALLED' | 'RECORDER_CHUNK_ERROR';

export class RecordingWatchdog {
  private mediaRecorder: MediaRecorder | null = null;
  private onEvent: (event: RecordingWatchdogEvent) => void;
  private destroyed = false;
  
  private lastChunkTime = 0;
  private checkTimer: ReturnType<typeof setInterval> | null = null;
  private STALL_TIMEOUT_MS = 15000; // 15 seconds without chunks is a stall

  constructor(onEvent: (event: RecordingWatchdogEvent) => void) {
    this.onEvent = onEvent;
  }

  start(mediaRecorder: MediaRecorder): void {
    if (this.destroyed) return;
    this.mediaRecorder = mediaRecorder;
    this.lastChunkTime = Date.now();
    
    if (this.checkTimer !== null) {
      clearInterval(this.checkTimer);
    }

    this.checkTimer = setInterval(() => {
      this.checkHealth();
    }, 2000);
  }

  notifyChunkReceived(): void {
    this.lastChunkTime = Date.now();
  }

  notifyResumed(): void {
    this.lastChunkTime = Date.now();
  }

  private checkHealth(): void {
    if (this.destroyed || !this.mediaRecorder) return;
    
    if (this.mediaRecorder.state === 'recording') {
      const timeSinceLastChunk = Date.now() - this.lastChunkTime;
      // MediaRecorder starts with a chunk interval, but if it takes too long it might be stalled
      // We expect chunks every timeslice (e.g. 250ms). If 10 seconds pass, it's definitely stalled.
      if (timeSinceLastChunk > this.STALL_TIMEOUT_MS) {
        this.onEvent('RECORDER_STALLED');
      }
    }
  }

  destroy(): void {
    this.destroyed = true;
    if (this.checkTimer !== null) {
      clearInterval(this.checkTimer);
      this.checkTimer = null;
    }
    this.mediaRecorder = null;
  }
}
