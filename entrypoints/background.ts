/**
 * Background Service Worker.
 * Acts as the orchestrator, managing recording state, launching the
 * offscreen document, creating the camera preview window, and triggering downloads.
 */

let recordingState: 'idle' | 'starting' | 'recording' = 'idle';
let duration = 0;
let includeMic = false;
let includeCam = false;
let cameraWindowId: number | null = null;
let hasSystemAudio = false;
let currentError: string | null = null;

// Initialize background task listener
export default defineBackground(() => {
  // Listen for messages from popup and offscreen document
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.type) {
      case 'START_RECORDING_FLOW':
        includeMic = message.includeMic;
        includeCam = message.includeCam;
        startRecordingFlow();
        sendResponse({ success: true });
        break;

      case 'STOP_RECORDING_FLOW':
        stopRecordingFlow();
        sendResponse({ success: true });
        break;

      case 'GET_RECORDING_STATUS':
        sendResponse({
          recordingState,
          duration,
          error: currentError,
          includeMic,
          includeCam
        });
        break;

      case 'RECORDING_TICK':
        duration = message.duration;
        broadcastState();
        sendResponse({ success: true });
        break;

      case 'RECORDING_ERROR':
        currentError = message.error;
        recordingState = 'idle';
        broadcastState();
        cleanupCamera();
        closeOffscreenDocument();
        sendResponse({ success: true });
        break;

      case 'RECORDING_WARNING':
        console.warn('Offscreen warning:', message.warning);
        sendResponse({ success: true });
        break;

      case 'RECORDING_COMPLETE':
        handleRecordingComplete(message.url, message.mimeType);
        sendResponse({ success: true });
        break;
    }
    return true; // Keep message channel open for asynchronous responses
  });
});

/**
 * Initiates the recording flow by launching the offscreen document.
 */
function startRecordingFlow() {
  recordingState = 'starting';
  currentError = null;
  broadcastState();

  (async () => {
    // Open floating camera preview if selected
    if (includeCam) {
      try {
        const win = await chrome.windows.create({
          url: 'camera.html',
          type: 'popup',
          width: 240,
          height: 240,
          top: 80,
          left: 80,
          focused: false // Avoid stealing focus
        });
        cameraWindowId = win.id || null;
      } catch (err) {
        console.error('Failed to create camera preview window:', err);
      }
    }

    try {
      // Open offscreen document
      await createOffscreenDocument();

      // Delay slightly to ensure offscreen document receiver is initialized and active
      await new Promise((resolve) => setTimeout(resolve, 500));

      recordingState = 'recording';
      duration = 0;
      broadcastState();

      // Message offscreen to start actual capture
      chrome.runtime.sendMessage({
        type: 'START_RECORDING',
        includeMic
      });
    } catch (err: any) {
      console.error('Failed to set up recording context:', err);
      recordingState = 'idle';
      currentError = err.message || 'Failed to initialize recording document';
      broadcastState();
      cleanupCamera();
    }
  })();
}

/**
 * Requests the offscreen document to stop recording.
 */
function stopRecordingFlow() {
  chrome.runtime.sendMessage({ type: 'STOP_RECORDING' }).catch((err) => {
    console.error('Failed to send stop command to offscreen:', err);
    // Force cleanup if offscreen document is dead
    recordingState = 'idle';
    broadcastState();
    cleanupCamera();
    closeOffscreenDocument();
  });
}

/**
 * Triggered when recording completes. Triggers the browser download.
 */
function handleRecordingComplete(blobUrl: string, mimeType: string) {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const timestamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
  
  // Choose extension based on actual recording MIME type
  const isMp4 = mimeType && mimeType.includes('video/mp4');
  const ext = isMp4 ? 'mp4' : 'webm';
  const filename = `recording-${timestamp}.${ext}`;

  chrome.downloads.download({
    url: blobUrl,
    filename: filename,
    saveAs: false
  }, () => {
    // Reset status
    recordingState = 'idle';
    duration = 0;
    broadcastState();
    cleanupCamera();

    // Close offscreen document after a delay to ensure download streams have closed
    setTimeout(() => {
      closeOffscreenDocument();
    }, 2000);
  });
}

/**
 * Creates the offscreen document if it doesn't already exist.
 */
async function createOffscreenDocument() {
  try {
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: [chrome.offscreen.Reason.DISPLAY_MEDIA],
      justification: 'Capture screen and mix audio tracks'
    });
  } catch (err: any) {
    if (err.message.includes('Only one offscreen document')) {
      // Already open, no issue
      return;
    }
    throw err;
  }
}

/**
 * Closes the offscreen document.
 */
async function closeOffscreenDocument() {
  try {
    await chrome.offscreen.closeDocument();
  } catch (err) {
    console.warn('Offscreen document close error (might already be closed):', err);
  }
}

/**
 * Closes the camera preview window.
 */
function cleanupCamera() {
  if (cameraWindowId !== null) {
    chrome.windows.remove(cameraWindowId, () => {
      cameraWindowId = null;
    });
  }
}

/**
 * Sends state updates to any open extension views (e.g. Popup).
 */
function broadcastState() {
  chrome.runtime.sendMessage({
    type: 'STATE_CHANGED',
    state: {
      recordingState,
      duration,
      error: currentError,
      includeMic,
      includeCam
    }
  }).catch(() => {
    // Ignore error when no active components are listening (e.g., popup closed)
  });
}
