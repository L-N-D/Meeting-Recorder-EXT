/**
 * Helper class to manage the MediaRecorder lifecycle, chunk collection,
 * and media track cleanup.
 */
export class ScreenRecorder {
  private mediaRecorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private onBlobReady: (blob: Blob) => void;
  private onTimeUpdate: (seconds: number) => void;
  private onError: (error: Error) => void;
  
  private startTime: number = 0;
  private timerInterval: any = null;
  private tracksToCleanup: MediaStreamTrack[] = [];
  private audioContextToCleanup: AudioContext | null = null;

  constructor(options: {
    onBlobReady: (blob: Blob) => void;
    onTimeUpdate: (seconds: number) => void;
    onError: (error: Error) => void;
  }) {
    this.onBlobReady = options.onBlobReady;
    this.onTimeUpdate = options.onTimeUpdate;
    this.onError = options.onError;
  }

  /**
   * Starts recording the given MediaStream.
   * 
   * @param stream The final mixed MediaStream containing the video track and mixed audio track.
   * @param additionalTracks Media tracks (e.g., source tracks before mixing) that must be stopped on cleanup.
   * @param audioContext AudioContext that must be closed on cleanup.
   */
  public start(
    stream: MediaStream,
    additionalTracks: MediaStreamTrack[] = [],
    audioContext: AudioContext | null = null
  ) {
    this.chunks = [];
    this.tracksToCleanup = [...stream.getTracks(), ...additionalTracks];
    this.audioContextToCleanup = audioContext;

    // Prioritized list of MIME types (preferring MP4/H.264 formats for local playback compatibility)
    const candidates = [
      'video/mp4;codecs=h264,aac',
      'video/mp4;codecs=h264,opus',
      'video/mp4',
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm'
    ];

    let selectedType = '';
    for (const candidate of candidates) {
      if (MediaRecorder.isTypeSupported(candidate)) {
        selectedType = candidate;
        break;
      }
    }

    try {
      console.log('Starting MediaRecorder with mimeType:', selectedType || 'default');
      const options = selectedType ? { mimeType: selectedType } : {};
      this.mediaRecorder = new MediaRecorder(stream, options);
    } catch (e: any) {
      console.error('Failed to initialize MediaRecorder with candidate types, falling back to default:', e);
      try {
        this.mediaRecorder = new MediaRecorder(stream);
      } catch (err: any) {
        this.onError(new Error(`Failed to initialize MediaRecorder: ${err.message}`));
        this.cleanup();
        return;
      }
    }

    this.mediaRecorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        this.chunks.push(event.data);
      }
    };

    this.mediaRecorder.onstop = () => {
      const mimeType = this.mediaRecorder?.mimeType || 'video/webm';
      const finalBlob = new Blob(this.chunks, { type: mimeType });
      this.onBlobReady(finalBlob);
      this.cleanup();
    };

    this.mediaRecorder.onerror = (event: any) => {
      this.onError(event.error || new Error('MediaRecorder encountered an error'));
      this.cleanup();
    };

    // Start recording, collecting data in 1-second chunks
    this.mediaRecorder.start(1000);
    this.startTime = Date.now();

    // Start duration timer
    this.timerInterval = setInterval(() => {
      const elapsedSeconds = Math.floor((Date.now() - this.startTime) / 1000);
      this.onTimeUpdate(elapsedSeconds);
    }, 1000);
  }

  /**
   * Stops the current recording.
   */
  public stop() {
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.stop();
    } else {
      this.cleanup();
    }
  }

  /**
   * Forces cleanup of all streams, tracks, contexts, and timers.
   */
  public cleanup() {
    // Clear timer
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }

    // Stop all media tracks to release hardware locks
    this.tracksToCleanup.forEach((track) => {
      try {
        if (track.readyState !== 'ended') {
          track.stop();
        }
      } catch (e) {
        console.error('Failed to stop media track', e);
      }
    });
    this.tracksToCleanup = [];

    // Close AudioContext
    if (this.audioContextToCleanup) {
      try {
        if (this.audioContextToCleanup.state !== 'closed') {
          this.audioContextToCleanup.close();
        }
      } catch (e) {
        console.error('Failed to close AudioContext', e);
      }
      this.audioContextToCleanup = null;
    }

    this.mediaRecorder = null;
  }
}
