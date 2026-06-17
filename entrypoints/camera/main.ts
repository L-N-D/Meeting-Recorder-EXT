/**
 * Script for the floating camera preview window.
 * Uses Document Picture-in-Picture when available, with popup fallback.
 */

document.addEventListener('DOMContentLoaded', async () => {
  const videoElement = document.getElementById('webcam') as HTMLVideoElement;
  const placeholderElement = document.getElementById('placeholder');
  let stream: MediaStream | null = null;

  const notifyClosed = () => {
    chrome.runtime.sendMessage({ type: 'CAMERA_WINDOW_CLOSED' }).catch(() => undefined);
  };

  window.addEventListener('beforeunload', () => {
    stream?.getTracks().forEach((track) => track.stop());
    notifyClosed();
  });

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 640 },
        height: { ideal: 480 },
        facingMode: 'user',
      },
      audio: false,
    });

    if (videoElement) {
      videoElement.srcObject = stream;
      videoElement.onloadedmetadata = () => {
        if (placeholderElement) {
          placeholderElement.style.display = 'none';
        }
        videoElement.play().catch(console.error);
      };
    }

    await openDocumentPictureInPicture(videoElement, stream);
  } catch (err: any) {
    console.error('Failed to access camera for preview:', err);
    if (placeholderElement) {
      placeholderElement.textContent = `Camera error: ${err.message || 'Permission denied'}`;
      placeholderElement.style.color = '#ef4444';
    }
  }
});

async function openDocumentPictureInPicture(
  videoElement: HTMLVideoElement,
  stream: MediaStream
): Promise<void> {
  const pipApi = (window as any).documentPictureInPicture;
  if (!pipApi?.requestWindow) {
    return;
  }

  try {
    const pipWindow = await pipApi.requestWindow({
      width: 240,
      height: 240,
    });

    pipWindow.document.body.style.margin = '0';
    pipWindow.document.body.style.background = '#0f172a';

    const pipVideo = pipWindow.document.createElement('video');
    pipVideo.srcObject = stream;
    pipVideo.autoplay = true;
    pipVideo.playsInline = true;
    pipVideo.muted = true;
    pipVideo.style.cssText =
      'width:100%;height:100%;object-fit:cover;transform:scaleX(-1);border-radius:50%;';
    pipWindow.document.body.appendChild(pipVideo);
    pipVideo.play().catch(console.error);

    pipWindow.addEventListener('pagehide', () => {
      chrome.runtime.sendMessage({ type: 'CAMERA_WINDOW_CLOSED' }).catch(() => undefined);
    });

    chrome.runtime.sendMessage({ type: 'CAMERA_PIP_ACTIVE' }).catch(() => undefined);
    window.close();
  } catch (err) {
    console.warn('Document PiP unavailable, using popup window fallback:', err);
  }
}
