export type StreamHealthEvent =
  | 'VIDEO_FROZEN'
  | 'VIDEO_RECOVERED'
  | 'VIDEO_SOURCE_LOST'
  | 'AUDIO_SOURCE_LOST'
  | 'TRACK_MUTED'
  | 'TRACK_UNMUTED'
  | 'TRACK_ENDED';

export class StreamHealthMonitor {
  private videoTrack: MediaStreamTrack | null = null;
  private audioTracks: Map<string, MediaStreamTrack> = new Map();
  private onEvent: (event: StreamHealthEvent, trackId?: string) => void;
  private destroyed = false;
  
  // For frozen detection
  private canvasRouterWaitTimer: ReturnType<typeof setInterval> | null = null;
  
  constructor(onEvent: (event: StreamHealthEvent, trackId?: string) => void) {
    this.onEvent = onEvent;
  }

  setVideoTrack(track: MediaStreamTrack | null): void {
    if (this.destroyed) return;
    this.cleanupTrack(this.videoTrack);
    this.videoTrack = track;
    if (track) this.attachTrackListeners(track, 'video');
  }

  addAudioTrack(track: MediaStreamTrack): void {
    if (this.destroyed) return;
    if (!this.audioTracks.has(track.id)) {
      this.audioTracks.set(track.id, track);
      this.attachTrackListeners(track, 'audio');
    }
  }

  removeAudioTrack(trackId: string): void {
    const track = this.audioTracks.get(trackId);
    if (track) {
      this.cleanupTrack(track);
      this.audioTracks.delete(trackId);
    }
  }

  private attachTrackListeners(track: MediaStreamTrack, type: 'video' | 'audio'): void {
    const handleMute = () => {
      if (this.destroyed) return;
      this.onEvent('TRACK_MUTED', track.id);
    };
    const handleUnmute = () => {
      if (this.destroyed) return;
      this.onEvent('TRACK_UNMUTED', track.id);
    };
    const handleEnded = () => {
      if (this.destroyed) return;
      this.onEvent('TRACK_ENDED', track.id);
      if (type === 'video') {
        this.onEvent('VIDEO_SOURCE_LOST', track.id);
      } else {
        this.onEvent('AUDIO_SOURCE_LOST', track.id);
      }
    };

    track.addEventListener('mute', handleMute);
    track.addEventListener('unmute', handleUnmute);
    track.addEventListener('ended', handleEnded);

    // Store listeners on the track object for easy cleanup
    (track as any)._healthListeners = { handleMute, handleUnmute, handleEnded };
  }

  private cleanupTrack(track: MediaStreamTrack | null): void {
    if (!track) return;
    const listeners = (track as any)._healthListeners;
    if (listeners) {
      track.removeEventListener('mute', listeners.handleMute);
      track.removeEventListener('unmute', listeners.handleUnmute);
      track.removeEventListener('ended', listeners.handleEnded);
      delete (track as any)._healthListeners;
    }
  }

  destroy(): void {
    this.destroyed = true;
    this.cleanupTrack(this.videoTrack);
    this.videoTrack = null;
    this.audioTracks.forEach(track => this.cleanupTrack(track));
    this.audioTracks.clear();
    
    if (this.canvasRouterWaitTimer) {
      clearInterval(this.canvasRouterWaitTimer);
      this.canvasRouterWaitTimer = null;
    }
  }
}
