/**
 * DownloadService
 * ===============
 *
 * Handles file download triggering via chrome.downloads API, monitors download states,
 * and executes callbacks upon download completion or failure.
 */
export class DownloadService {
  private onFinishCallback: (error?: string, sessionId?: string) => void;

  constructor(onFinish: (error?: string, sessionId?: string) => void) {
    this.onFinishCallback = onFinish;
  }

  public download(url: string, mimeType: string, sessionId?: string): void {
    if (!url) {
      this.onFinishCallback('Recording failed: no video data was produced.', sessionId);
      return;
    }

    const isMp4 = mimeType?.includes('video/mp4');
    const ext = isMp4 ? 'mp4' : 'webm';
    const filename = `recording-${this.buildTimestamp()}.${ext}`;

    chrome.downloads.download({ url, filename, saveAs: false }, (downloadId) => {
      if (chrome.runtime.lastError || downloadId === undefined) {
        this.onFinishCallback(`Download failed: ${chrome.runtime.lastError?.message || 'unknown error'}`, sessionId);
        return;
      }

      let settled = false;
      const settle = (error?: string) => {
        if (settled) return;
        settled = true;
        chrome.downloads.onChanged.removeListener(onChanged);
        this.onFinishCallback(error, sessionId);
      };

      const onChanged = (delta: chrome.downloads.DownloadDelta) => {
        if (delta.id !== downloadId || !delta.state) return;
        if (delta.state.current === 'complete') settle();
        else if (delta.state.current === 'interrupted')
          settle('Download was interrupted before completing.');
      };
      chrome.downloads.onChanged.addListener(onChanged);

      chrome.downloads.search({ id: downloadId }, (items) => {
        const item = items?.[0];
        if (item?.state === 'complete') settle();
        else if (item?.state === 'interrupted')
          settle('Download was interrupted before completing.');
      });
    });
  }

  private buildTimestamp(): string {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return (
      `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` +
      `-${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`
    );
  }
}

