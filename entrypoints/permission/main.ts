/**
 * Standalone Permission Setup Script
 */

document.addEventListener('DOMContentLoaded', () => {
  const actionBtn = document.getElementById('action-btn') as HTMLButtonElement | null;
  const guideBox = document.getElementById('guide-box') as HTMLDivElement | null;
  const pageTitle = document.getElementById('page-title') as HTMLDivElement | null;
  const pageDesc = document.getElementById('page-desc') as HTMLDivElement | null;
  const statusLabel = document.getElementById('status-label') as HTMLDivElement | null;
  const statusIcon = document.getElementById('status-icon') as SVGElement | null;

  // Parse query parameters to check what permissions are required
  const params = new URLSearchParams(window.location.search);
  const requireAudio = params.get('audio') === 'true' || params.get('audio') === null;
  const requireVideo = params.get('video') === 'true';

  const updateUIBlocked = (message: string) => {
    if (pageTitle) pageTitle.textContent = 'Permissions Blocked';
    if (pageDesc) pageDesc.textContent = `Chrome is blocking access to your device: ${message}. Follow the guide below to enable it.`;
    if (statusLabel) statusLabel.textContent = 'Setup Status: Blocked';
    if (guideBox) guideBox.classList.add('visible');
    if (actionBtn) {
      actionBtn.textContent = 'Re-check Access';
      actionBtn.disabled = false;
    }
    if (statusIcon) {
      statusIcon.style.stroke = '#ef4444'; // Red stroke
    }
  };

  const attemptCapture = async () => {
    if (actionBtn) {
      actionBtn.textContent = 'Requesting...';
      actionBtn.disabled = true;
    }
    if (statusLabel) statusLabel.textContent = 'Setup Status: Requesting...';

    let audioGranted = false;
    let videoGranted = false;

    // 1. Try Microphone Access if requested
    if (requireAudio) {
      try {
        const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        audioStream.getTracks().forEach((track) => track.stop());
        audioGranted = true;
      } catch (err: any) {
        console.warn('[permission-tab] mic access denied:', err);
      }
    }

    // 2. Try Camera Access if requested
    if (requireVideo) {
      try {
        const videoStream = await navigator.mediaDevices.getUserMedia({ video: true });
        videoStream.getTracks().forEach((track) => track.stop());
        videoGranted = true;
      } catch (err: any) {
        console.warn('[permission-tab] camera access denied:', err);
      }
    }

    const micOK = !requireAudio || audioGranted;
    const camOK = !requireVideo || videoGranted;

    if (micOK && camOK) {
      if (statusLabel) statusLabel.textContent = 'Setup Status: Access Granted!';
      if (actionBtn) actionBtn.textContent = 'Success!';
      if (statusIcon) statusIcon.style.stroke = '#10b981'; // Green stroke
      
      // Notify background / storage
      try {
        await chrome.storage.session.set({ audioCaptureGranted: true });
      } catch {
        // Fallback
      }

      // Close the tab immediately
      setTimeout(() => {
        window.close();
      }, 500);
    } else {
      let errorMsg = '';
      if (requireAudio && !audioGranted) errorMsg += 'Microphone ';
      if (requireVideo && !videoGranted) {
        if (errorMsg) errorMsg += 'and ';
        errorMsg += 'Camera ';
      }
      errorMsg += 'access required.';
      updateUIBlocked(errorMsg);
    }
  };

  if (actionBtn) {
    actionBtn.addEventListener('click', attemptCapture);
  }

  // Attempt capture immediately on page load to trigger Chrome dialog automatically
  void attemptCapture();
});
