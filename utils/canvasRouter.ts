/**
 * Routes an active video source through a hidden canvas so MediaRecorder
 * keeps a stable output stream while the underlying capture source changes.
 *
 * IMPORTANT: this runs inside an offscreen document, which is never painted.
 * `requestAnimationFrame` does not fire reliably there, so the draw loop and
 * frame-wait use timers (setInterval / setTimeout) instead.
 */
export type FitMode = 'contain' | 'cover' | 'stretch';

export interface CanvasRouterOptions {
  width?: number;
  height?: number;
  fps?: number;
  fitMode?: FitMode;
  maxScale?: number;
  warnWhenSourceSmall?: boolean;
}

function calculateContainRect(
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
  maxScale: number
) {
  const scaleX = targetWidth / sourceWidth;
  const scaleY = targetHeight / sourceHeight;

  const containScale = Math.min(scaleX, scaleY);
  const scale = Math.min(containScale, maxScale);

  const width = sourceWidth * scale;
  const height = sourceHeight * scale;

  return {
    x: (targetWidth - width) / 2,
    y: (targetHeight - height) / 2,
    width,
    height,
    scale
  };
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
  private placeholderMessage: string | null = null;

  // New properties for source quality and fit mode
  private fitMode: FitMode;
  private maxScale: number;
  private warnWhenSourceSmall: boolean;
  private lastWarningSentTime = 0;
  private wasWarningActive = false;

  constructor(options: CanvasRouterOptions = {}) {
    const width = options.width ?? 1920;
    const height = options.height ?? 1080;
    this.fps = options.fps ?? 30;
    this.fitMode = options.fitMode ?? 'contain';
    this.maxScale = options.maxScale ?? 1.5;
    this.warnWhenSourceSmall = options.warnWhenSourceSmall ?? true;

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

  switchToPlaceholder(message: string): void {
    if (this.destroyed) return;
    this.placeholderMessage = message;
    
    if (this.activeStream) {
      this.activeStream.getVideoTracks().forEach((track) => {
        if (track.readyState !== 'ended') track.stop();
      });
      this.activeStream = null;
    }
    this.videoElement.srcObject = null;
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
    this.placeholderMessage = null;

    // Send clear quality warning if it was active
    if (this.wasWarningActive) {
      this.wasWarningActive = false;
      chrome.runtime.sendMessage({
        type: 'SOURCE_QUALITY_WARNING_CLEARED'
      }).catch(() => undefined);
    }

    this.videoElement.srcObject = null;
    this.outputStream.getTracks().forEach((track) => track.stop());
  }

  private checkSourceQuality(sourceWidth: number, sourceHeight: number, scale: number): void {
    const isSourceTooSmall =
      sourceWidth < 1000 ||
      sourceHeight < 600 ||
      scale >= this.maxScale;

    const now = Date.now();
    if (isSourceTooSmall) {
      const shouldSend = !this.wasWarningActive || (now - this.lastWarningSentTime >= 5000);
      if (shouldSend) {
        this.wasWarningActive = true;
        this.lastWarningSentTime = now;
        chrome.runtime.sendMessage({
          type: 'SOURCE_QUALITY_WARNING',
          payload: {
            reason: 'SOURCE_TOO_SMALL',
            sourceWidth,
            sourceHeight,
            outputWidth: this.canvas.width,
            outputHeight: this.canvas.height,
            scale,
            message: 'Captured window is too small. Please enlarge it to keep the recording readable.'
          }
        }).catch(() => undefined);
      }
    } else {
      if (this.wasWarningActive) {
        this.wasWarningActive = false;
        chrome.runtime.sendMessage({
          type: 'SOURCE_QUALITY_WARNING_CLEARED'
        }).catch(() => undefined);
      }
    }
  }

  private drawWarningOverlay(): void {
    this.ctx.save();

    const text = 'Captured window is small. Please enlarge it for better readability.';
    this.ctx.font = '24px sans-serif';
    const textMetrics = this.ctx.measureText(text);
    const paddingX = 16;
    const paddingY = 12;

    const rectWidth = textMetrics.width + paddingX * 2;
    const rectHeight = 24 + paddingY * 2; // ~24px font + padding

    // Bottom-left corner
    const x = 30;
    const y = this.canvas.height - rectHeight - 30;

    // Translucent black background
    this.ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
    this.ctx.beginPath();
    if (typeof this.ctx.roundRect === 'function') {
      this.ctx.roundRect(x, y, rectWidth, rectHeight, 8);
    } else {
      this.ctx.rect(x, y, rectWidth, rectHeight);
    }
    this.ctx.fill();

    // White text
    this.ctx.fillStyle = '#FFFFFF';
    this.ctx.textAlign = 'left';
    this.ctx.textBaseline = 'middle';
    this.ctx.fillText(text, x + paddingX, y + rectHeight / 2);

    this.ctx.restore();
  }

  private startRenderLoop(): void {
    const intervalMs = Math.max(1, Math.round(1000 / this.fps));
    this.renderTimer = setInterval(() => {
      if (this.destroyed) {
        return;
      }
      
      if (this.placeholderMessage) {
        this.ctx.fillStyle = '#000000';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        this.ctx.fillStyle = '#FFFFFF';
        this.ctx.font = '48px sans-serif';
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'middle';
        this.ctx.fillText(this.placeholderMessage, this.canvas.width / 2, this.canvas.height / 2);
      } else if (this.activeStream && this.videoElement.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        const sourceWidth = this.videoElement.videoWidth;
        const sourceHeight = this.videoElement.videoHeight;

        let rect = {
          x: 0,
          y: 0,
          width: this.canvas.width,
          height: this.canvas.height,
          scale: 1
        };

        if (this.fitMode === 'contain') {
          rect = calculateContainRect(
            sourceWidth,
            sourceHeight,
            this.canvas.width,
            this.canvas.height,
            this.maxScale
          );
        } else if (this.fitMode === 'cover') {
          const scale = Math.max(this.canvas.width / sourceWidth, this.canvas.height / sourceHeight);
          const width = sourceWidth * scale;
          const height = sourceHeight * scale;
          rect = {
            x: (this.canvas.width - width) / 2,
            y: (this.canvas.height - height) / 2,
            width,
            height,
            scale
          };
        } else {
          // stretch
          rect = {
            x: 0,
            y: 0,
            width: this.canvas.width,
            height: this.canvas.height,
            scale: 1
          };
        }

        // Fill black background first (no-stretch black padding)
        this.ctx.fillStyle = '#000000';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        // Draw the video frame
        this.ctx.drawImage(
          this.videoElement,
          rect.x,
          rect.y,
          rect.width,
          rect.height
        );

        // Check source quality and send updates
        if (this.warnWhenSourceSmall) {
          this.checkSourceQuality(sourceWidth, sourceHeight, rect.scale);
        }

        // Draw overlay if warning is active
        if (this.wasWarningActive) {
          this.drawWarningOverlay();
        }
      }
    }, intervalMs);
  }
}
