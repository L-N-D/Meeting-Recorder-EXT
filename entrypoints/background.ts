/**
 * Background Service Worker.
 * Orchestrates recording state, offscreen handshake, Focus 1-1 tab switching,
 * camera preview lifecycle, and downloads.
 */

import { TabFocusDetector } from '../utils/tabFocusDetector';
import {
  DEFAULT_AUDIO_SETTINGS,
  type AudioMixSettings,
  type PendingRecordingIntent,
  type RecordingState,
  type RecordingStatusPayload,
} from '../utils/types';

let recordingState: RecordingState = 'idle';
let duration = 0;
let includeMic = false;
let includeCam = false;
let focusMode = false;
let audioSettings: AudioMixSettings = { ...DEFAULT_AUDIO_SETTINGS };
let cameraWindowId: number | null = null;
let cameraBubbleTabId: number | null = null;
let currentError: string | null = null;
let pendingRecordingIntent: PendingRecordingIntent | null = null;
let offscreenReadyResolve: (() => void) | null = null;
let offscreenReadyPromise: Promise<void> | null = null;

const tabFocusDetector = new TabFocusDetector((tabId) => {
  void switchRecordingSource(tabId);
});

function resetOffscreenReadyPromise(): void {
  offscreenReadyPromise = new Promise<void>((resolve) => {
    offscreenReadyResolve = resolve;
  });
}

function resolveOffscreenReady(): void {
  offscreenReadyResolve?.();
  offscreenReadyResolve = null;
}

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

export default defineBackground(() => {
  resetOffscreenReadyPromise();

  chrome.windows.onRemoved.addListener((windowId) => {
    if (cameraWindowId !== null && windowId === cameraWindowId) {
      cameraWindowId = null;
      includeCam = false;
      broadcastState();
    }
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    switch (message.type) {
      case 'START_RECORDING_FLOW':
        includeMic = message.includeMic;
        includeCam = message.includeCam;
        focusMode = message.focusMode ?? false;
        audioSettings = message.audioSettings ?? { ...DEFAULT_AUDIO_SETTINGS };
        startRecordingFlow();
        sendResponse({ success: true });
        break;

      case 'STOP_RECORDING_FLOW':
        stopRecordingFlow();
        sendResponse({ success: true });
        break;

      case 'PAUSE_RECORDING_FLOW':
        if (recordingState === 'recording') {
          recordingState = 'paused';
          broadcastState();
          chrome.runtime.sendMessage({ type: 'PAUSE_RECORDING' }).catch(console.error);
        }
        sendResponse({ success: true });
        break;

      case 'RESUME_RECORDING_FLOW':
        if (recordingState === 'paused') {
          recordingState = 'recording';
          broadcastState();
          chrome.runtime.sendMessage({ type: 'RESUME_RECORDING' }).catch(console.error);
        }
        sendResponse({ success: true });
        break;

      case 'GET_RECORDING_STATUS':
        sendResponse(getStatusPayload());
        break;

      case 'SET_PENDING_RECORDING':
        pendingRecordingIntent = {
          includeMic: message.includeMic,
          includeCam: message.includeCam,
          focusMode: message.focusMode ?? false,
          audioSettings: message.audioSettings ?? { ...DEFAULT_AUDIO_SETTINGS },
        };
        sendResponse({ success: true });
        break;

      case 'PERMISSIONS_GRANTED':
        if (pendingRecordingIntent) {
          includeMic = pendingRecordingIntent.includeMic;
          includeCam = pendingRecordingIntent.includeCam;
          focusMode = pendingRecordingIntent.focusMode;
          audioSettings = pendingRecordingIntent.audioSettings;
          pendingRecordingIntent = null;
          startRecordingFlow();
        }
        sendResponse({ success: true });
        break;

      case 'OFFSCREEN_READY':
        resolveOffscreenReady();
        sendResponse({ success: true });
        break;

      case 'CAPTURE_STARTED':
        recordingState = 'recording';
        duration = 0;
        broadcastState();

        if (focusMode) {
          void registerCapturedTabs();
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

      case 'RECORDING_ERROR':
        currentError = message.error;
        recordingState = 'idle';
        broadcastState();
        tabFocusDetector.stop();
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

      case 'CAMERA_WINDOW_CLOSED':
        includeCam = false;
        cameraWindowId = null;
        broadcastState();
        sendResponse({ success: true });
        break;

      case 'CAMERA_PIP_ACTIVE':
        cameraWindowId = null;
        broadcastState();
        sendResponse({ success: true });
        break;
    }

    return true;
  });
});

async function registerCapturedTabs(): Promise<void> {
  try {
    const capturedTabs = await chrome.tabCapture.getCapturedTabs();
    const tabIds = capturedTabs.map((tab) => tab.tabId).filter((id) => id > 0);
    if (tabIds.length > 0) {
      tabFocusDetector.start(tabIds);
    }
  } catch (err) {
    console.warn('Unable to register captured tabs for Focus 1-1:', err);
  }
}

async function switchRecordingSource(tabId: number): Promise<void> {
  if (recordingState !== 'recording' && recordingState !== 'paused') {
    return;
  }

  try {
    const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
    await chrome.runtime.sendMessage({
      type: 'SWITCH_SOURCE',
      streamId,
      tabId,
    });
  } catch (err) {
    console.warn(`Failed to switch recording source to tab ${tabId}:`, err);
  }
}

function startRecordingFlow(): void {
  recordingState = 'starting';
  currentError = null;
  broadcastState();
  resetOffscreenReadyPromise();

  void (async () => {
    if (includeCam) {
      await openCameraPreview();
    }

    try {
      await createOffscreenDocument();
      await waitForOffscreenReady(5000);

      await chrome.runtime.sendMessage({
        type: 'START_RECORDING',
        includeMic,
        focusMode,
        audioSettings,
      });

      // recordingState becomes "recording" after CAPTURE_STARTED from offscreen
    } catch (err: any) {
      console.error('Failed to set up recording context:', err);
      recordingState = 'idle';
      currentError = err.message || 'Failed to initialize recording document';
      broadcastState();
      tabFocusDetector.stop();
      cleanupCamera();
    }
  })();
}

function stopRecordingFlow(): void {
  tabFocusDetector.stop();
  chrome.runtime.sendMessage({ type: 'STOP_RECORDING' }).catch((err) => {
    console.error('Failed to send stop command to offscreen:', err);
    recordingState = 'idle';
    broadcastState();
    cleanupCamera();
    closeOffscreenDocument();
  });
}

function handleRecordingComplete(blobUrl: string, mimeType: string): void {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const timestamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;

  const isMp4 = mimeType && mimeType.includes('video/mp4');
  const ext = isMp4 ? 'mp4' : 'webm';
  const filename = `recording-${timestamp}.${ext}`;

  tabFocusDetector.stop();

  chrome.downloads.download(
    {
      url: blobUrl,
      filename,
      saveAs: false,
    },
    () => {
      recordingState = 'idle';
      duration = 0;
      broadcastState();
      cleanupCamera();

      setTimeout(() => {
        closeOffscreenDocument();
      }, 2000);
    }
  );
}

async function waitForOffscreenReady(timeoutMs: number): Promise<void> {
  if (!offscreenReadyPromise) {
    resetOffscreenReadyPromise();
  }

  await Promise.race([
    offscreenReadyPromise,
    new Promise<void>((_, reject) => {
      setTimeout(() => reject(new Error('Offscreen document did not become ready in time')), timeoutMs);
    }),
  ]);
}

async function createOffscreenDocument(): Promise<void> {
  try {
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: [chrome.offscreen.Reason.DISPLAY_MEDIA],
      justification: 'Capture screen and mix audio tracks',
    });
  } catch (err: any) {
    if (err.message.includes('Only one offscreen document')) {
      resolveOffscreenReady();
      return;
    }
    throw err;
  }
}

async function closeOffscreenDocument(): Promise<void> {
  try {
    await chrome.offscreen.closeDocument();
  } catch (err) {
    console.warn('Offscreen document close error (might already be closed):', err);
  }
}

async function openCameraPreview(): Promise<void> {
  try {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (activeTab?.id && activeTab.url?.startsWith('http')) {
      await injectCameraBubble(activeTab.id);
      cameraBubbleTabId = activeTab.id;
      return;
    }
  } catch (err) {
    console.warn('Camera bubble injection failed, falling back to popup window:', err);
  }

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
    console.error('Failed to create camera preview window:', err);
  }
}

async function injectCameraBubble(tabId: number): Promise<void> {
  await chrome.scripting.executeScript({
    target: { tabId },
    func: createCameraBubble,
  });
}

function createCameraBubble(): void {
  if (document.getElementById('screen-recorder-camera-bubble')) {
    return;
  }

  const bubble = document.createElement('div');
  bubble.id = 'screen-recorder-camera-bubble';
  bubble.style.cssText = [
    'position:fixed',
    'bottom:24px',
    'right:24px',
    'width:160px',
    'height:160px',
    'border-radius:50%',
    'overflow:hidden',
    'border:3px solid #3b82f6',
    'box-shadow:0 10px 25px rgba(0,0,0,0.35)',
    'z-index:2147483647',
    'cursor:move',
    'background:#0f172a',
  ].join(';');

  const video = document.createElement('video');
  video.autoplay = true;
  video.playsInline = true;
  video.muted = true;
  video.style.cssText = 'width:100%;height:100%;object-fit:cover;transform:scaleX(-1);';
  bubble.appendChild(video);

  const closeBtn = document.createElement('button');
  closeBtn.textContent = '×';
  closeBtn.style.cssText = [
    'position:absolute',
    'top:6px',
    'right:8px',
    'width:24px',
    'height:24px',
    'border:none',
    'border-radius:50%',
    'background:rgba(15,23,42,0.8)',
    'color:#fff',
    'cursor:pointer',
    'font-size:16px',
    'line-height:1',
  ].join(';');
  closeBtn.onclick = () => {
    bubble.remove();
    chrome.runtime.sendMessage({ type: 'CAMERA_WINDOW_CLOSED' });
  };
  bubble.appendChild(closeBtn);

  document.body.appendChild(bubble);

  let dragOffsetX = 0;
  let dragOffsetY = 0;
  let dragging = false;

  bubble.addEventListener('mousedown', (event) => {
    dragging = true;
    dragOffsetX = event.clientX - bubble.offsetLeft;
    dragOffsetY = event.clientY - bubble.offsetTop;
  });

  window.addEventListener('mousemove', (event) => {
    if (!dragging) {
      return;
    }
    bubble.style.left = `${event.clientX - dragOffsetX}px`;
    bubble.style.top = `${event.clientY - dragOffsetY}px`;
    bubble.style.right = 'auto';
    bubble.style.bottom = 'auto';
  });

  window.addEventListener('mouseup', () => {
    dragging = false;
  });

  navigator.mediaDevices
    .getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
      audio: false,
    })
    .then((stream) => {
      video.srcObject = stream;
      (bubble as any).__cameraStream = stream;
    })
    .catch((err) => {
      bubble.style.display = 'flex';
      bubble.style.alignItems = 'center';
      bubble.style.justifyContent = 'center';
      bubble.style.color = '#fca5a5';
      bubble.style.fontSize = '12px';
      bubble.textContent = `Camera error: ${err.message || 'denied'}`;
    });
}

function cleanupCamera(): void {
  if (cameraWindowId !== null) {
    chrome.windows.remove(cameraWindowId, () => {
      cameraWindowId = null;
    });
  }

  if (cameraBubbleTabId !== null) {
    chrome.scripting
      .executeScript({
        target: { tabId: cameraBubbleTabId },
        func: () => {
          const bubble = document.getElementById('screen-recorder-camera-bubble');
          if (bubble) {
            const stream = (bubble as any).__cameraStream as MediaStream | undefined;
            stream?.getTracks().forEach((track) => track.stop());
            bubble.remove();
          }
        },
      })
      .catch(() => undefined);
    cameraBubbleTabId = null;
  }

  includeCam = false;
}

function broadcastState(): void {
  chrome.runtime
    .sendMessage({
      type: 'STATE_CHANGED',
      state: getStatusPayload(),
    })
    .catch(() => undefined);
}
