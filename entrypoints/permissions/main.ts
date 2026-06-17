/**
 * Script for the permissions onboarding page.
 * Requests mic/camera access and notifies background to auto-start recording.
 */

document.addEventListener('DOMContentLoaded', () => {
  const urlParams = new URLSearchParams(window.location.search);
  const requestMic = urlParams.get('mic') !== 'false';
  const requestCam = urlParams.get('cam') === 'true';
  const focusMode = urlParams.get('focus') === 'true';

  const grantBtn = document.getElementById('grant-btn') as HTMLButtonElement;
  const msgElement = document.getElementById('msg');
  const titleElement = document.getElementById('title');

  if (grantBtn && msgElement && titleElement) {
    grantBtn.addEventListener('click', async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: requestMic,
          video: requestCam,
        });

        stream.getTracks().forEach((track) => track.stop());

        titleElement.textContent = 'Access Granted!';
        msgElement.innerHTML =
          'Permissions authorized. Starting recording automatically...';
        msgElement.className = 'success-text';
        grantBtn.style.display = 'none';

        chrome.runtime.sendMessage({
          type: 'PERMISSIONS_GRANTED',
          includeMic: requestMic,
          includeCam: requestCam,
          focusMode,
        });

        setTimeout(() => {
          window.close();
        }, 1500);
      } catch (err: any) {
        console.error('Failed to request media permissions:', err);
        titleElement.textContent = 'Access Denied';
        msgElement.className = 'error-text';

        if (err.name === 'NotAllowedError') {
          msgElement.innerHTML =
            'Permission request was denied. Please click the site settings icon (lock/camera) in the browser address bar to allow Microphone and Camera access for this extension.';
        } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
          msgElement.innerHTML =
            'Required hardware device (microphone/camera) was not found. Please uncheck missing devices in the popup and try again.';
        } else {
          msgElement.innerHTML = `An error occurred: ${err.message || 'Unknown media capture error'}`;
        }
      }
    });
  }
});
