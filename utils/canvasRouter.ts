/**
 * Routes an active video source through a hidden canvas so MediaRecorder
 * keeps a stable output stream while the underlying capture source changes.
 *
 * IMPORTANT: this runs inside an offscreen document, which is never painted.
 * `requestAnimationFrame` does not fire reliably there, so the draw loop and
 * frame-wait use timers (setInterval / setTimeout) instead.
 */
export interface CanvasRouterOptions {
  width?: number;
  height?: number;
  fps?: number;
}

export class CanvasRouter {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private videoElement: HTMLVideoElement;
  private outputStream: MediaStream;
  private renderTimer: ReturnType<typeof setInterval> | null = null;
  private activeStream: MediaStream | null = null;
  private destroyed = false;
  private fps: number;

  constructor(options: CanvasRouterOptions = {}) {
    const width = options.width ?? 1920;
    const height = options.height ?? 1080;
    this.fps = options.fps ?? 30;

    this.canvas = document.createElement('canvas');
    this.canvas.width = width;
    this.canvas.height = height;

    const context = this.canvas.getContext('2d');
    if (!context) {
      throw new Error('Failed to create 2D canvas context');
    }
    this.ctx = context;

    this.videoElement = document.createElement('video');
    this.videoElement.muted = true;
    this.videoElement.playsInline = true;

    this.outputStream = this.canvas.captureStream(this.fps);
    this.startRenderLoop();
  }

  setActiveSource(stream: MediaStream): void {
    if (this.destroyed) {
      return;
    }

    const previousStream = this.activeStream;
    this.activeStream = stream;
    this.videoElement.srcObject = stream;
    this.videoElement.play().catch((err) => {
      console.warn('[canvasRouter] video play failed:', err);
    });

    if (previousStream && previousStream !== stream) {
      previousStream.getVideoTracks().forEach((track) => {
        if (track.readyState !== 'ended') {
          track.stop();
        }
      });
    }
  }

  getOutputStream(): MediaStream {
    return this.outputStream;
  }

  /** Wait until the active source has a drawable frame (or timeout). */
  waitForFrame(timeoutMs = 3000): Promise<void> {
    return new Promise((resolve) => {
      const start = Date.now();
      const poll = () => {
        if (
          this.destroyed ||
          (this.activeStream && this.videoElement.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) ||
          Date.now() - start > timeoutMs
        ) {
          resolve();
          return;
        }
        setTimeout(poll, 50);
      };
      poll();
    });
  }

  resize(width: number, height: number): void {
    this.canvas.width = width;
    this.canvas.height = height;
  }

  destroy(): void {
    this.destroyed = true;

    if (this.renderTimer !== null) {
      clearInterval(this.renderTimer);
      this.renderTimer = null;
    }

    if (this.activeStream) {
      this.activeStream.getVideoTracks().forEach((track) => track.stop());
      this.activeStream = null;
    }

    this.videoElement.srcObject = null;
    this.outputStream.getTracks().forEach((track) => track.stop());
  }

  private startRenderLoop(): void {
    const intervalMs = Math.max(1, Math.round(1000 / this.fps));
    this.renderTimer = setInterval(() => {
      if (this.destroyed) {
        return;
      }
      if (this.activeStream && this.videoElement.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        this.ctx.drawImage(this.videoElement, 0, 0, this.canvas.width, this.canvas.height);
      }
    }, intervalMs);
  }
}
