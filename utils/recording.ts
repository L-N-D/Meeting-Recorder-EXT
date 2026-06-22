import { ChunkStorage } from './chunkStorage';
import { fixWebmDuration } from './webmDurationFix';
import { RecordingWatchdog } from './recordingWatchdog';
import { RecordingDurationLimiter } from './durationLimiter';
import { RECORDING_LIMITS, type RecordingLimitEvent } from './recordingLimits';

/**
 * Helper class to manage the MediaRecorder lifecycle, chunk collection,
 * and media track cleanup.
 */
export class ScreenRecorder {
  private mediaRecorder: MediaRecorder | null = null;
  private chunkStorage = new ChunkStorage();
  private onRecordingReady: (sessionId: string, mimeType: string, stopReason?: string) => void;
  private onTimeUpdate: (seconds: number) => void;
  private onError: (error: Error) => void;
  private onStateChange: (state: 'recording' | 'paused') => void;

  private startTime = 0;
  private pausedAt = 0;
  private totalPausedMs = 0;
  private initialDurationMs = 0;
  private timerInterval: ReturnType<typeof setInterval> | null = null;
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private tracksToCleanup: MediaStreamTrack[] = [];
  private audioContextToCleanup: AudioContext | null = null;
  private recordedMimeType = 'video/webm';
  private pendingChunkWrites: Promise<void>[] = [];
  private stopResolve: (() => void) | null = null;
  private watchdog: RecordingWatchdog;
  private durationLimiter: RecordingDurationLimiter;
  private stopReason: string | null = null;
  private chunkCount = 0;

  constructor(options: {
    onRecordingReady: (sessionId: string, mimeType: string, stopReason?: string) => void;
    onTimeUpdate: (seconds: number) => void;
    onError: (error: Error) => void;
    onStateChange?: (state: 'recording' | 'paused') => void;
    onLimitEvent?: (event: RecordingLimitEvent, elapsedMs: number, message: string) => void;
  }) {
    this.onRecordingReady = options.onRecordingReady;
    this.onTimeUpdate = options.onTimeUpdate;
    this.onError = options.onError;
    this.onStateChange = options.onStateChange ?? (() => undefined);

    this.watchdog = new RecordingWatchdog((event) => {
      if (event === 'RECORDER_STALLED') {
        console.warn('[recorder] Watchdog detected stalled recording!');
        chrome.runtime.sendMessage({ type: 'RECORDING_WARNING', warning: 'Video encoding appears stalled. Output may be incomplete.' }).catch(() => undefined);
      }
    });

    this.durationLimiter = new RecordingDurationLimiter((event, elapsedMs, message) => {
      if (event === 'MAX_DURATION_REACHED') {
        console.warn('[recorder] Hard limit reached! Automatically stopping recording.');
        void this.stop('MAX_DURATION_REACHED');
      }
      if (options.onLimitEvent) {
        options.onLimitEvent(event, elapsedMs, message);
      }
    });
  }

  public getDurationSec(): number {
    return Math.floor(this.getElapsedMs() / 1000);
  }

  public getChunkCount(): number {
    return this.chunkCount;
  }

  public getSessionId(): string {
    return this.chunkStorage.getSessionId();
  }

  public getState(): 'recording' | 'paused' | 'inactive' {
    if (!this.mediaRecorder) return 'inactive';
    return this.mediaRecorder.state as 'recording' | 'paused' | 'inactive';
  }

  public async start(
    stream: MediaStream,
    additionalTracks: MediaStreamTrack[] = [],
    audioContext: AudioContext | null = null,
    sessionId?: string,
    isContinuation = false,
    initialDurationSec = 0,
    hasConfirmedDurationExtension = false
  ): Promise<void> {
    this.durationLimiter.reset();
    this.durationLimiter.setConfirmedExtension(hasConfirmedDurationExtension);
    this.stopReason = null;
    this.tracksToCleanup = [...stream.getTracks(), ...additionalTracks];
    this.audioContextToCleanup = audioContext;
    this.startTime = Date.now();
    this.pausedAt = 0;
    this.totalPausedMs = 0;
    this.initialDurationMs = initialDurationSec * 1000;

    try {
      if (isContinuation && sessionId) {
        await this.chunkStorage.initExisting(sessionId);
        this.chunkCount = this.chunkStorage.getChunkCount();
        console.log(`[recorder] Resuming session ${sessionId}. Initial chunkCount: ${this.chunkCount}, initialDuration: ${initialDurationSec}s`);
      } else {
        await this.chunkStorage.init(sessionId);
        this.chunkCount = 0;
      }
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

    this.mediaRecorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        this.chunkCount += 1;
        this.watchdog.notifyChunkReceived();
        console.log('[recorder] chunk', this.chunkCount, 'size:', event.data.size);
        const write = this.chunkStorage.appendChunk(event.data).catch((storageErr) => {
          console.error('[recorder] failed to persist chunk to IndexedDB:', storageErr);
          let errorMsg = 'Failed to persist recording chunk';
          if (storageErr && (storageErr.name === 'QuotaExceededError' || storageErr.message?.includes('QuotaExceededError'))) {
            errorMsg = 'Disk space is full or storage quota exceeded. Recording stopped.';
          }
          this.onError(new Error(errorMsg));
          void this.stop();
        });
        this.pendingChunkWrites.push(write);
      } else {
        if (this.mediaRecorder?.state === 'recording') {
          console.warn('[recorder] dataavailable fired with empty data while recording');
        } else {
          console.log('[recorder] dataavailable fired with empty data (normal during stop)');
        }
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

    if (audioContext && audioContext.state === 'suspended') {
      try {
        await audioContext.resume();
        console.log('[recorder] AudioContext resumed successfully before start');
      } catch (err) {
        console.warn('[recorder] Failed to resume AudioContext before start:', err);
      }
    }

    this.mediaRecorder.start(1000); // 1-second chunks per design refinement
    this.watchdog.start(this.mediaRecorder);
    console.log('[recorder] MediaRecorder started, mime:', this.recordedMimeType, 'state:', this.mediaRecorder.state);
    this.onStateChange('recording');

    this.startHeartbeatTimer();
    void this.updateHeartbeat(); // Write metadata immediately on start

    this.timerInterval = setInterval(() => {
      const elapsedMs = this.getElapsedMs();
      const elapsedSeconds = Math.floor(elapsedMs / 1000);
      this.onTimeUpdate(elapsedSeconds);
      this.durationLimiter.check(elapsedMs);
    }, 1000);
  }

  public confirmDurationExtension(): void {
    this.durationLimiter.setConfirmedExtension(true);
  }

  public pause(): void {
    if (this.mediaRecorder?.state === 'recording') {
      this.mediaRecorder.pause();
      this.pausedAt = Date.now();
      this.onStateChange('paused');
      void this.updateHeartbeat(); // Immediate metadata update on pause
    }
  }

  public resume(): void {
    if (this.mediaRecorder?.state === 'paused') {
      this.mediaRecorder.resume();
      this.watchdog.notifyResumed();
      if (this.pausedAt > 0) {
        this.totalPausedMs += Date.now() - this.pausedAt;
        this.pausedAt = 0;
      }
      this.onStateChange('recording');
      void this.updateHeartbeat(); // Immediate metadata update on resume
    }
  }

  public stop(reason?: string): Promise<void> {
    this.stopHeartbeatTimer();
    this.stopReason = reason || null;
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
    this.watchdog.destroy();
    this.stopHeartbeatTimer();

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

    if (this.mediaRecorder) {
      this.mediaRecorder.ondataavailable = null;
      this.mediaRecorder.onstop = null;
      this.mediaRecorder.onerror = null;
      this.mediaRecorder = null;
    }
  }

  private getElapsedMs(): number {
    let pausedMs = this.totalPausedMs;
    if (this.pausedAt > 0) {
      pausedMs += Date.now() - this.pausedAt;
    }
    return Math.max(0, Date.now() - this.startTime - pausedMs + this.initialDurationMs);
  }

  private startHeartbeatTimer(): void {
    this.stopHeartbeatTimer();
    this.heartbeatInterval = setInterval(() => {
      void this.updateHeartbeat();
    }, 5000); // 5-second interval per design refinement
  }

  private stopHeartbeatTimer(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  private async updateHeartbeat(): Promise<void> {
    try {
      const sessionId = this.chunkStorage.getSessionId();
      const duration = Math.floor(this.getElapsedMs() / 1000);
      const chunkCount = this.chunkCount;
      const status = this.mediaRecorder?.state === 'paused' ? 'paused' : 'recording';

      await chrome.runtime.sendMessage({
        type: 'RECORDING_HEARTBEAT',
        sessionId,
        duration,
        chunkCount,
        status,
      });
    } catch (err) {
      console.warn('[recorder] failed to send heartbeat message:', err);
    }
  }

  private async finalizeRecording(): Promise<void> {
    const mimeType = this.recordedMimeType;
    const sessionId = this.chunkStorage.getSessionId();

    try {
      await Promise.all(this.pendingChunkWrites);
      this.pendingChunkWrites = [];

      if (this.chunkCount === 0) {
        this.onError(
          new Error('Recording is empty. Keep recording for at least a few seconds before stopping.')
        );
        return;
      }

      this.onRecordingReady(sessionId, mimeType, this.stopReason || undefined);
    } catch (err) {
      this.onError(new Error(`Failed to finalize recording: ${(err as Error).message}`));
    } finally {
      this.cleanup();
      this.stopResolve?.();
      this.stopResolve = null;
    }
  }
}
