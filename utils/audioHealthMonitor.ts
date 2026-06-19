export type AudioHealthEvent = 'AUDIO_SILENT' | 'AUDIO_SIGNAL_LOW' | 'AUDIO_ACTIVE';

export class AudioHealthMonitor {
  private audioContext: AudioContext;
  private analyserNodes: Map<string, AnalyserNode> = new Map();
  private sourceNodes: Map<string, MediaStreamAudioSourceNode> = new Map();
  private signalStates: Map<string, 'active' | 'silent'> = new Map();
  private onEvent: (event: AudioHealthEvent, trackId: string) => void;
  private destroyed = false;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  
  // Thresholds
  private SILENCE_THRESHOLD = 0.001;
  private REQUIRED_SILENT_SAMPLES = 10; // 10 consecutive polls (~5 seconds) to declare lost
  private silentSampleCount: Map<string, number> = new Map();

  constructor(onEvent: (event: AudioHealthEvent, trackId: string) => void) {
    this.onEvent = onEvent;
    this.audioContext = new AudioContext();
    this.startPolling();
  }

  addTrack(track: MediaStreamTrack): void {
    if (this.destroyed || track.kind !== 'audio') return;
    if (this.analyserNodes.has(track.id)) return;

    try {
      const stream = new MediaStream([track]);
      const source = this.audioContext.createMediaStreamSource(stream);
      const analyser = this.audioContext.createAnalyser();
      analyser.fftSize = 2048;
      
      source.connect(analyser);
      
      this.sourceNodes.set(track.id, source);
      this.analyserNodes.set(track.id, analyser);
      this.signalStates.set(track.id, 'active');
      this.silentSampleCount.set(track.id, 0);
    } catch (err) {
      console.warn('[AudioHealthMonitor] Failed to add track:', err);
    }
  }

  removeTrack(trackId: string): void {
    const source = this.sourceNodes.get(trackId);
    if (source) {
      source.disconnect();
      this.sourceNodes.delete(trackId);
    }
    this.analyserNodes.delete(trackId);
    this.signalStates.delete(trackId);
    this.silentSampleCount.delete(trackId);
  }

  private startPolling(): void {
    this.pollTimer = setInterval(() => {
      if (this.destroyed) return;
      this.checkSignals();
    }, 500); // Check every 500ms
  }

  private checkSignals(): void {
    for (const [trackId, analyser] of this.analyserNodes.entries()) {
      const data = new Float32Array(analyser.fftSize);
      analyser.getFloatTimeDomainData(data);
      
      let sumSquares = 0;
      for (let i = 0; i < data.length; i++) {
        sumSquares += data[i] * data[i];
      }
      const rms = Math.sqrt(sumSquares / data.length);
      
      const currentState = this.signalStates.get(trackId);
      let silentCount = this.silentSampleCount.get(trackId) ?? 0;

      if (rms < this.SILENCE_THRESHOLD) {
        silentCount++;
        this.silentSampleCount.set(trackId, silentCount);
        
        if (silentCount >= this.REQUIRED_SILENT_SAMPLES && currentState !== 'silent') {
          this.signalStates.set(trackId, 'silent');
          this.onEvent('AUDIO_SILENT', trackId);
        }
      } else {
        this.silentSampleCount.set(trackId, 0);
        if (currentState === 'silent') {
          this.signalStates.set(trackId, 'active');
          this.onEvent('AUDIO_ACTIVE', trackId);
        }
      }
    }
  }

  destroy(): void {
    this.destroyed = true;
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.sourceNodes.forEach(source => source.disconnect());
    this.sourceNodes.clear();
    this.analyserNodes.clear();
    this.audioContext.close().catch(() => undefined);
  }
}
