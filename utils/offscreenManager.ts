/**
 * OffscreenManager
 * ================
 *
 * Encapsulates the lifecycle, handshake, and communication with the
 * Chrome Offscreen Document.
 */
export class OffscreenManager {
  private offscreenReadyResolve: (() => void) | null = null;
  private offscreenReadyPromise: Promise<void> | null = null;

  public resetReadyPromise(): void {
    this.offscreenReadyPromise = new Promise<void>((resolve) => {
      this.offscreenReadyResolve = resolve;
    });
  }

  public resolveReady(): void {
    this.offscreenReadyResolve?.();
    this.offscreenReadyResolve = null;
  }

  public async ensureDocument(): Promise<void> {
    await this.closeDocument();
    this.resetReadyPromise();

    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: [
        chrome.offscreen.Reason.DISPLAY_MEDIA,
        chrome.offscreen.Reason.USER_MEDIA,
        chrome.offscreen.Reason.AUDIO_PLAYBACK,
      ],
      justification: 'Capture screen/tab/app audio, mix audio, and monitor to speakers',
    });

    await Promise.race([
      this.offscreenReadyPromise,
      new Promise<void>((_, reject) =>
        setTimeout(
          () => reject(new Error('Offscreen document did not become ready in time')),
          5000
        )
      ),
    ]);
  }

  public async closeDocument(): Promise<void> {
    try {
      await chrome.offscreen.closeDocument();
    } catch {
      // Already closed — safe to ignore.
    } finally {
      this.offscreenReadyResolve = null;
      this.offscreenReadyPromise = null;
    }
  }

  public ping(): Promise<any> {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'OFFSCREEN_PING' }, (response) => {
        if (chrome.runtime.lastError) {
          resolve(null);
        } else {
          resolve(response);
        }
      });
    });
  }
}
