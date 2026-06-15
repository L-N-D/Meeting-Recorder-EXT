/**
 * Script for the floating camera preview window.
 * Requests webcam access and handles display lifecycle.
 */

document.addEventListener('DOMContentLoaded', async () => {
  const videoElement = document.getElementById('webcam') as HTMLVideoElement;
  const placeholderElement = document.getElementById('placeholder');
  let stream: MediaStream | null = null;

  try {
    // Request video access from camera
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 640 },
        height: { ideal: 480 },
        facingMode: 'user'
      },
      audio: false
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
  } catch (err: any) {
    console.error('Failed to access camera for preview:', err);
    if (placeholderElement) {
      placeholderElement.textContent = `Camera error: ${err.message || 'Permission denied'}`;
      placeholderElement.style.color = '#ef4444';
    }
  }

  // Cleanup stream if window is closed
  window.addEventListener('beforeunload', () => {
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
    }
  });
});
