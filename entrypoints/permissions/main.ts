/**
 * Script for the permissions onboarding page.
 * Requests mic/camera access and handles results.
 */

document.addEventListener('DOMContentLoaded', () => {
  const urlParams = new URLSearchParams(window.location.search);
  const requestMic = urlParams.get('mic') !== 'false';
  const requestCam = urlParams.get('cam') === 'true';

  const grantBtn = document.getElementById('grant-btn') as HTMLButtonElement;
  const msgElement = document.getElementById('msg');
  const titleElement = document.getElementById('title');

  if (grantBtn && msgElement && titleElement) {
    grantBtn.addEventListener('click', async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: requestMic,
          video: requestCam
        });
        
        // Stop all tracks immediately
        stream.getTracks().forEach((track) => track.stop());

        titleElement.textContent = 'Access Granted!';
        msgElement.innerHTML = 'Permissions successfully authorized. This tab will close automatically in a moment...';
        msgElement.className = 'success-text';
        grantBtn.style.display = 'none';

        // Auto close after 1.5 seconds
        setTimeout(() => {
          window.close();
        }, 1500);
      } catch (err: any) {
        console.error('Failed to request media permissions:', err);
        titleElement.textContent = 'Access Denied';
        msgElement.className = 'error-text';
        
        if (err.name === 'NotAllowedError') {
          msgElement.innerHTML = 'Permission request was denied. Please click the site settings icon (lock/camera) in the browser address bar to allow Microphone and Camera access for this extension.';
        } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
          msgElement.innerHTML = 'Required hardware device (microphone/camera) was not found. Please uncheck missing devices in the popup and try again.';
        } else {
          msgElement.innerHTML = `An error occurred: ${err.message || 'Unknown media capture error'}`;
        }
      }
    });
  }
});
