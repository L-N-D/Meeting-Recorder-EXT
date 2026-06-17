/**
 * Background Service Worker.
 *
 * Single source of truth for recording state. Responsibilities:
 *   - Own the recording lifecycle state machine (idle/starting/recording/paused).
 *   - Manage the offscreen document handshake (it does the actual capture).
 *   - Drive Focus 1-1 tab switching.
 *   - Manage the camera preview window.
 *   - Save the finished recording via chrome.downloads.
 *
 * The popup is a thin client: it sends commands and renders the broadcast state.
 */

import { TabFocusDetector } from '../utils/tabFocusDetector';
import {
  DEFAULT_AUDIO_SETTINGS,
  type AudioMixSettings,
  type RecordingState,
  type RecordingStatusPayload,
} from '../utils/types';

const LOG = '[background]';

// ---- Recording state (the single source of truth) ----------------------------
let recordingState: RecordingState = 'idle';
let duration = 0;
let includeMic = false;
let includeCam = false;
let focusMode = false;
let audioSettings: AudioMixSettings = { ...DEFAULT_AUDIO_SETTINGS };
let selectedTabIds: number[] = [];
let currentError: string | null = null;

// ---- Side-channel resources --------------------------------------------------
let cameraWindowId: number | null = null;
let offscreenReadyResolve: (() => void) | null = null;
let offscreenReadyPromise: Promise<void> | null = null;

// Safety net: if capture never starts (e.g. the screen picker is dismissed in a
// way that never resolves, or a tab stream id expires), recover instead of
// leaving the UI stuck on "Setting up capture…" forever.
const CAPTURE_START_TIMEOUT_MS = 90_000;
let captureWatchdog: ReturnType<typeof setTimeout> | null = null;

function clearCaptureWatchdog(): void {
  if (captureWatchdog !== null) {
    clearTimeout(captureWatchdog);
    captureWatchdog = null;
  }
}

function armCaptureWatchdog(): void {
  clearCaptureWatchdog();
  captureWatchdog = setTimeout(() => {
    captureWatchdog = null;
    if (recordingState !== 'starting') {
      return;
    }
    console.warn(LOG, 'capture did not start within timeout — resetting.');
    recordingState = 'idle';
    duration = 0;
    currentError = 'Capture did not start. No source was selected, or the screen dialog was blocked. Please try again.';
    broadcastState();
    tabFocusDetector.stop();
    cleanupCamera();
    void closeOffscreenDocument();
  }, CAPTURE_START_TIMEOUT_MS);
}

const tabFocusDetector = new TabFocusDetector((tabId) => {
  void switchRecordingSource(tabId);
});

function getStatusPayload(): RecordingStatusPayload {
  return {
    recordingState,
    duration,
    error: currentError,
    includeMic,
    includeCam,
    focusMode,
    audioSettings,
  };
}

function broadcastState(): void {
  chrome.runtime
    .sendMessage({ type: 'STATE_CHANGED', state: getStatusPayload() })
    .catch(() => undefined); // No popup listening — expected, ignore.
}

export default defineBackground(() => {
  resetOffscreenReadyPromise();

  // If the user closes the camera preview window manually, reflect it in state.
  chrome.windows.onRemoved.addListener((windowId) => {
    if (cameraWindowId !== null && windowId === cameraWindowId) {
      cameraWindowId = null;
      includeCam = false;
      broadcastState();
    }
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    switch (message.type) {
      // ---- Commands from the popup --------------------------------------------
      case 'START_RECORDING_FLOW':
        includeMic = message.includeMic;
        includeCam = message.includeCam;
        focusMode = message.focusMode ?? false;
        selectedTabIds = message.selectedTabIds ?? [];
        audioSettings = message.audioSettings ?? { ...DEFAULT_AUDIO_SETTINGS };
        startRecordingFlow(message.startingTabId);
        sendResponse({ success: true });
        break;

      case 'STOP_RECORDING_FLOW':
        stopRecordingFlow();
        sendResponse({ success: true });
        break;

      case 'PAUSE_RECORDING_FLOW':
        if (recordingState === 'recording') {
          chrome.runtime.sendMessage({ type: 'PAUSE_RECORDING' }).catch(() => undefined);
        }
        sendResponse({ success: true });
        break;

      case 'RESUME_RECORDING_FLOW':
        if (recordingState === 'paused') {
          chrome.runtime.sendMessage({ type: 'RESUME_RECORDING' }).catch(() => undefined);
        }
        sendResponse({ success: true });
        break;

      case 'GET_RECORDING_STATUS':
        sendResponse(getStatusPayload());
        break;

      // ---- Events from the offscreen document ---------------------------------
      case 'OFFSCREEN_READY':
        resolveOffscreenReady();
        sendResponse({ success: true });
        break;

      case 'CAPTURE_STARTED':
        clearCaptureWatchdog();
        recordingState = 'recording';
        duration = 0;
        broadcastState();
        if (focusMode && selectedTabIds.length > 0) {
          tabFocusDetector.start(selectedTabIds);
        }
        sendResponse({ success: true });
        break;

      case 'RECORDING_TICK':
        duration = message.duration;
        broadcastState();
        sendResponse({ success: true });
        break;

      case 'RECORDING_PAUSED':
        recordingState = 'paused';
        broadcastState();
        sendResponse({ success: true });
        break;

      case 'RECORDING_RESUMED':
        recordingState = 'recording';
        broadcastState();
        sendResponse({ success: true });
        break;

      case 'RECORDING_WARNING':
        // Non-fatal: surface the message but keep recording.
        currentError = message.warning;
        broadcastState();
        sendResponse({ success: true });
        break;

      case 'RECORDING_ERROR':
        clearCaptureWatchdog();
        currentError = message.error;
        recordingState = 'idle';
        duration = 0;
        broadcastState();
        tabFocusDetector.stop();
        cleanupCamera();
        void closeOffscreenDocument();
        sendResponse({ success: true });
        break;

      case 'RECORDING_COMPLETE':
        handleRecordingComplete(message.url, message.mimeType);
        sendResponse({ success: true });
        break;

      // ---- Events from the camera preview window ------------------------------
      case 'CAMERA_WINDOW_CLOSED':
        includeCam = false;
        cameraWindowId = null;
        broadcastState();
        sendResponse({ success: true });
        break;
    }

    return true; // Keep the message channel open for async sendResponse.
  });
});

// ---- Offscreen document handshake -------------------------------------------

function resetOffscreenReadyPromise(): void {
  offscreenReadyPromise = new Promise<void>((resolve) => {
    offscreenReadyResolve = resolve;
  });
}

function resolveOffscreenReady(): void {
  offscreenReadyResolve?.();
  offscreenReadyResolve = null;
}

async function ensureOffscreenDocument(): Promise<void> {
  await closeOffscreenDocument();
  resetOffscreenReadyPromise();

  await chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: [chrome.offscreen.Reason.DISPLAY_MEDIA],
    justification: 'Capture screen and mix audio tracks',
  });

  await Promise.race([
    offscreenReadyPromise,
    new Promise<void>((_, reject) =>
      setTimeout(() => reject(new Error('Offscreen document did not become ready in time')), 5000)
    ),
  ]);
}

async function closeOffscreenDocument(): Promise<void> {
  try {
    await chrome.offscreen.closeDocument();
  } catch {
    // Already closed — safe to ignore.
  } finally {
    offscreenReadyResolve = null;
    offscreenReadyPromise = null;
  }
}

// ---- Recording lifecycle -----------------------------------------------------

function startRecordingFlow(startingTabId?: number): void {
  recordingState = 'starting';
  currentError = null;
  broadcastState();

  void (async () => {
    try {
      console.log(LOG, 'startRecordingFlow: focusMode=', focusMode, 'mic=', includeMic, 'cam=', includeCam);
      await ensureOffscreenDocument();
      console.log(LOG, 'offscreen ready');

      // Focus 1-1 records a specific tab via tabCapture; full mode uses the
      // system screen picker (handled inside the offscreen document).
      let initialStreamId: string | null = null;
      if (focusMode && startingTabId) {
        initialStreamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: startingTabId });
        console.log(LOG, 'tab stream id acquired for tab', startingTabId);
      }

      if (includeCam) {
        await openCameraPreview();
      }

      // Arm the watchdog right before handing off to the offscreen document —
      // everything after this point (screen picker, getUserMedia) is where a
      // stall can happen.
      armCaptureWatchdog();

      await chrome.runtime.sendMessage({
        type: 'START_RECORDING',
        includeMic,
        focusMode,
        audioSettings,
        initialStreamId,
      });
      console.log(LOG, 'START_RECORDING sent to offscreen, awaiting CAPTURE_STARTED');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to initialize recording';
      console.error(LOG, 'start failed:', err);
      clearCaptureWatchdog();
      recordingState = 'idle';
      currentError = message;
      broadcastState();
      tabFocusDetector.stop();
      cleanupCamera();
      await closeOffscreenDocument();
    }
  })();
}

function stopRecordingFlow(): void {
  if (recordingState !== 'recording' && recordingState !== 'paused') {
    return;
  }

  // Keep showing "starting" so the popup renders a "Saving…" state while the
  // offscreen document finalizes the file.
  recordingState = 'starting';
  broadcastState();
  tabFocusDetector.stop();

  chrome.runtime.sendMessage({ type: 'STOP_RECORDING' }).catch(async (err) => {
    console.error(LOG, 'failed to send stop command:', err);
    recordingState = 'idle';
    currentError = 'Failed to stop recording. Please try again.';
    broadcastState();
    cleanupCamera();
    await closeOffscreenDocument();
  });
}

function handleRecordingComplete(blobUrl: string, mimeType: string): void {
  tabFocusDetector.stop();
  console.log(LOG, 'RECORDING_COMPLETE received. mimeType:', mimeType, 'hasUrl:', Boolean(blobUrl));

  const finish = (error?: string) => {
    recordingState = 'idle';
    duration = 0;
    currentError = error ?? null;
    broadcastState();
    cleanupCamera();
    void closeOffscreenDocument();
  };

  if (!blobUrl) {
    finish('Recording failed: no video data was produced.');
    return;
  }

  const isMp4 = mimeType?.includes('video/mp4');
  const ext = isMp4 ? 'mp4' : 'webm';
  const filename = `recording-${buildTimestamp()}.${ext}`;

  chrome.downloads.download({ url: blobUrl, filename, saveAs: false }, (downloadId) => {
    if (chrome.runtime.lastError || downloadId === undefined) {
      console.error(LOG, 'downloads.download() failed:', chrome.runtime.lastError);
      finish(`Download failed: ${chrome.runtime.lastError?.message || 'unknown error'}`);
      return;
    }

    console.log(LOG, 'download started, id:', downloadId, 'filename:', filename);

    // The blob lives in the offscreen document. Keep that document alive until
    // the download has fully read the data, otherwise large files can be
    // truncated. Settle exactly once on completion / interruption.
    let settled = false;
    const settle = (error?: string) => {
      if (settled) {
        return;
      }
      settled = true;
      chrome.downloads.onChanged.removeListener(onChanged);
      if (error) {
        console.error(LOG, 'download settled with error:', error);
      } else {
        console.log(LOG, 'download complete, id:', downloadId);
      }
      finish(error);
    };

    const onChanged = (delta: chrome.downloads.DownloadDelta) => {
      if (delta.id !== downloadId || !delta.state) {
        return;
      }
      if (delta.state.current === 'complete') {
        settle();
      } else if (delta.state.current === 'interrupted') {
        settle('Download was interrupted before completing.');
      }
    };
    chrome.downloads.onChanged.addListener(onChanged);

    // Race guard: the download may have already finished before the listener
    // was attached, in which case onChanged would never fire for it.
    chrome.downloads.search({ id: downloadId }, (items) => {
      const item = items?.[0];
      if (item?.state === 'complete') {
        settle();
      } else if (item?.state === 'interrupted') {
        settle('Download was interrupted before completing.');
      }
    });
  });
}

function buildTimestamp(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` +
    `-${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`
  );
}

// ---- Focus 1-1 source switching ----------------------------------------------

async function switchRecordingSource(tabId: number): Promise<void> {
  if (recordingState !== 'recording' && recordingState !== 'paused') {
    return;
  }

  try {
    const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
    await chrome.runtime.sendMessage({ type: 'SWITCH_SOURCE', streamId, tabId });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'capture unavailable';
    console.warn(LOG, 'could not switch tab:', message);
    currentError = `Could not switch to tab: ${message}`;
    broadcastState();
  }
}

// ---- Camera preview ----------------------------------------------------------
// Opened as an extension-origin popup window so getUserMedia reuses the
// extension's camera permission (reliable across all sites).

async function openCameraPreview(): Promise<void> {
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
    cameraWindowId = win?.id ?? null;
  } catch (err) {
    console.error(LOG, 'failed to open camera preview window:', err);
  }
}

function cleanupCamera(): void {
  if (cameraWindowId !== null) {
    const id = cameraWindowId;
    cameraWindowId = null;
    chrome.windows.remove(id).catch(() => undefined);
  }
  includeCam = false;
}
