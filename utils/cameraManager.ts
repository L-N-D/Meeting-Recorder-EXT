/**
 * CameraManager
 * =============
 *
 * Manages the camera preview popup window lifecycle and updates state accordingly.
 */
export class CameraManager {
  private cameraWindowId: number | null = null;
  private onClosedCallback?: () => void;

  constructor(onClosed?: () => void) {
    this.onClosedCallback = onClosed;
  }

  public getWindowId(): number | null {
    return this.cameraWindowId;
  }

  public setWindowId(id: number | null): void {
    this.cameraWindowId = id;
  }

  public async open(): Promise<void> {
    try {
      const win = await chrome.windows.create({
        url: 'camera.html',
        type: 'popup',
        width: 240,
        height: 240,
        top: 80,
        left: 80,
        focused: false,
      });
      this.cameraWindowId = win?.id ?? null;
    } catch (err) {
      console.warn('[cameraManager] failed to open camera preview:', err);
    }
  }

  public cleanup(): void {
    if (this.cameraWindowId !== null) {
      const id = this.cameraWindowId;
      this.cameraWindowId = null;
      chrome.windows.remove(id).catch(() => undefined);
    }
    this.onClosedCallback?.();
  }

  public handleWindowRemoved(windowId: number): boolean {
    if (this.cameraWindowId !== null && windowId === this.cameraWindowId) {
      this.cameraWindowId = null;
      this.onClosedCallback?.();
      return true;
    }
    return false;
  }
}
