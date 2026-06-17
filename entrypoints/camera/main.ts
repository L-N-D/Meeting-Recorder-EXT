/**
 * Camera preview window (extension origin).
 *
 * Shown as a small floating popup window while "Camera overlay" is enabled.
 * Running at the extension origin means getUserMedia reuses the permission the
 * popup already requested, so it works reliably regardless of the active site.
 */

document.addEventListener('DOMContentLoaded', async () => {
  const videoElement = document.getElementById('webcam') as HTMLVideoElement | null;
  const placeholderElement = document.getElementById('placeholder');
  let stream: MediaStream | null = null;

  window.addEventListener('beforeunload', () => {
    stream?.getTracks().forEach((track) => track.stop());
    chrome.runtime.sendMessage({ type: 'CAMERA_WINDOW_CLOSED' }).catch(() => undefined);
  });

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
      audio: false,
    });

    if (videoElement) {
      videoElement.srcObject = stream;
      videoElement.onloadedmetadata = () => {
        if (placeholderElement) {
          placeholderElement.style.display = 'none';
        }
        videoElement.play().catch((err) => console.error('[camera] play failed:', err));
      };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Permission denied';
    console.error('[camera] failed to access camera:', err);
    if (placeholderElement) {
      placeholderElement.textContent = `Camera error: ${message}`;
      placeholderElement.style.color = '#ef4444';
    }
  }
});
