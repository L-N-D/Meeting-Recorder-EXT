/**
 * Background Service Worker — EXT Recorder
 * =========================================
 *
 * Single source of truth for all recording state and the native audio session.
 *
 * Responsibilities:
 *   - Open the SidePanel on toolbar-icon click.
 *   - Own the recording lifecycle state machine (idle/starting/recording/paused).
 *   - Detect displaySurface === "window" from the offscreen document and
 *     automatically invoke the native host to prepare application audio.
 *   - Manage the native audio session lifecycle (connect, prepare, mirror, cleanup).
 *   - Drive Focus 1-1 tab switching.
 *   - Manage the camera preview window.
 *   - Save the finished recording via chrome.downloads.
 *   - Broadcast state + log lines to the SidePanel.
 *   - Guarantee cleanup on recording stop, error, extension suspend, and port disconnect.
 */

import { NativeAudioBridge } from '../utils/nativeAudio';
import { deriveSessionName, deriveSinkName, isOpaqueWindowLabel } from '../utils/audioSessionNaming';
import {
  captureTargetFromPrepareResult,
  type VirtualCaptureTarget,
} from '../utils/virtualCaptureDevice';
import { TabFocusDetector } from '../utils/tabFocusDetector';
import {
  DEFAULT_APP_AUDIO_STATE,
  DEFAULT_AUDIO_SETTINGS,
  type AppAudioState,
  type AudioMixSettings,
  type AudioSession,
  type LogLine,
  type NativeHelperStatus,
  type RecordingState,
  type RecordingStatusPayload,
} from '../utils/types';
import { OffscreenManager } from '../utils/offscreenManager';
import { CameraManager } from '../utils/cameraManager';
import { DownloadService } from '../utils/downloadService';

const LOG = '[background]';
const MAX_LOG_LINES = 100;

// ---------------------------------------------------------------------------
// Logging — all log lines also broadcast to the SidePanel.
// ---------------------------------------------------------------------------

const logBuffer: LogLine[] = [];
const telemetryBuffer: { ts: number; event: string; details?: any }[] = [];

function bgLog(level: LogLine['level'], msg: string): void {
  console[level]?.(LOG, msg);
  const line: LogLine = { ts: Date.now(), level, msg };
  logBuffer.push(line);
  if (logBuffer.length > MAX_LOG_LINES) logBuffer.shift();
  chrome.runtime
    .sendMessage({ type: 'LOG_LINE', line })
    .catch(() => undefined);
}

function telemetryLog(event: string, details?: any): void {
  telemetryBuffer.push({ ts: Date.now(), event, details });
  if (telemetryBuffer.length > 500) telemetryBuffer.shift();
  bgLog('info', `[TELEMETRY] ${event} ${details ? JSON.stringify(details) : ''}`);
}

// ---------------------------------------------------------------------------
// Recording state (the single source of truth)
// ---------------------------------------------------------------------------

let recordingState: RecordingState = 'idle';
let duration = 0;
let includeMic = false;
let includeCam = false;
let focusMode = false;
let audioSettings: AudioMixSettings = { ...DEFAULT_AUDIO_SETTINGS };
let currentError: string | null = null;

let focusStartTabId: number | null = null;
let currentSourceTabId: number | null = null;
let currentSessionId: string | null = null;

const ARM_MENU_ID = 'arm-focus-tab';

async function syncStateToStorage(): Promise<void> {
  await chrome.storage.session.set({
    recordingState,
    duration,
    currentError,
    includeMic,
    includeCam,
    focusMode,
    audioSettings,
    appAudioState,
  });
}

async function hydrateStateFromStorage(): Promise<void> {
  const data = (await chrome.storage.session.get(null)) as any;
  if (data.recordingState) recordingState = data.recordingState;
  if (data.duration !== undefined) duration = data.duration;
  if (data.currentError !== undefined) currentError = data.currentError;
  if (data.includeMic !== undefined) includeMic = data.includeMic;
  if (data.includeCam !== undefined) includeCam = data.includeCam;
  if (data.focusMode !== undefined) focusMode = data.focusMode;
  if (data.audioSettings) audioSettings = data.audioSettings;
  if (data.appAudioState) appAudioState = data.appAudioState;
}

// ---------------------------------------------------------------------------
// Native audio session state
// ---------------------------------------------------------------------------

const nativeAudio = new NativeAudioBridge();
let appAudioState: AppAudioState = { ...DEFAULT_APP_AUDIO_STATE };

/** The monitor device label hint last returned by prepareApplicationAudio. */
let nativeDeviceLabelHint: string | null = null;
/** PulseAudio sink_name slug for the current recording session. */
let currentAudioSinkName: string | null = null;
/** Human-readable session name (window title / screen label). */
let currentAudioSessionName: string | null = null;
/** PulseAudio monitor source name for the current virtual device. */
let currentAudioDeviceId: string | null = null;
/** Authoritative capture target from prepareApplicationAudio (stable IDs). */
let currentCaptureTarget: VirtualCaptureTarget | null = null;
/** Tracks in-progress async native audio setup to avoid duplicate calls. */
let nativeAudioPreparing = false;

function setNativeHelperStatus(status: NativeHelperStatus, error?: string): void {
  appAudioState = {
    ...appAudioState,
    nativeHelperStatus: status,
    error: error ?? appAudioState.error,
  };
  broadcastState();
}

function setAudioSessionStatus(
  sessionStatus: AppAudioState['sessionStatus'],
  extra?: Partial<AppAudioState>
): void {
  appAudioState = { ...appAudioState, sessionStatus, ...extra };
  void syncStateToStorage();
  broadcastState();
}

function addMirror(session: AudioSession): void {
  appAudioState = {
    ...appAudioState,
    sessionStatus: 'mirroring',
    mirrors: [...appAudioState.mirrors.filter((m) => m.pid !== session.pid), session],
  };
  broadcastState();
}

function clearAudioSession(): void {
  appAudioState = {
    ...appAudioState,
    sessionStatus: 'idle',
    deviceLabelHint: null,
    mirrors: [],
    error: null,
  };
  nativeDeviceLabelHint = null;
  currentAudioSinkName = null;
  currentAudioSessionName = null;
  currentAudioDeviceId = null;
  currentCaptureTarget = null;
  nativeAudioPreparing = false;
  attachAppAudioRetryCount = 0;
  void syncStateToStorage();
  broadcastState();
}

async function sendAttachAppAudioToOffscreen(): Promise<void> {
  if (!currentCaptureTarget) {
    bgLog('warn', 'sendAttachAppAudioToOffscreen: no capture target');
    return;
  }
  bgLog(
    'info',
    `ATTACH_APP_AUDIO → chromeCaptureSource=${currentCaptureTarget.chromeCaptureSource} sink=${currentCaptureTarget.sinkName} pulseIndex=${currentCaptureTarget.pulseSourceIndex ?? 'n/a'}`
  );
  await chrome.runtime
    .sendMessage({
      type: 'ATTACH_APP_AUDIO',
      captureTarget: currentCaptureTarget,
    })
    .catch(() => undefined);
}

let attachAppAudioRetryCount = 0;
const MAX_ATTACH_RETRIES = 3;

function scheduleAttachAppAudioRetry(): void {
  if (attachAppAudioRetryCount >= MAX_ATTACH_RETRIES) return;
  attachAppAudioRetryCount += 1;
  const delayMs = attachAppAudioRetryCount * 1200;
  bgLog('info', `scheduling virtual device attach retry ${attachAppAudioRetryCount}/${MAX_ATTACH_RETRIES} in ${delayMs}ms (fresh enumerateDevices)`);
  setTimeout(() => void sendAttachAppAudioToOffscreen(), delayMs);
}

function onNativeHostDisconnect(err?: string): void {
  bgLog('warn', `native host disconnected: ${err ?? 'unknown'}`);
  telemetryLog('NATIVE_DISCONNECTED', { err });
  // 'unknown' keeps the UI recoverable — the next ping/reconnect can succeed.
  setNativeHelperStatus('unknown');
  clearAudioSession();
}

let nativeConnectInFlight: Promise<boolean> | null = null;

async function ensureNativeConnected(): Promise<boolean> {
  if (nativeConnectInFlight) return nativeConnectInFlight;

  nativeConnectInFlight = (async () => {
    const tryPing = async (): Promise<boolean> => {
      try {
        await nativeAudio.ping();
        setNativeHelperStatus('connected');
        return true;
      } catch (err) {
        bgLog('warn', `native host ping failed: ${describeNativeError(err)}`);
        return false;
      }
    };

    if (!nativeAudio.isConnected()) {
      nativeAudio.connect(onNativeHostDisconnect);
      if (!nativeAudio.isConnected()) {
        setNativeHelperStatus('not_installed');
        return false;
      }
      // Host process needs a moment after Chrome spawns it.
      await new Promise<void>((r) => setTimeout(r, 150));
    }

    if (await tryPing()) return true;

    // Stale or dead port — open a fresh one (old onDisconnect is ignored via port guard).
    nativeAudio.disconnect();
    nativeAudio.connect(onNativeHostDisconnect);
    if (!nativeAudio.isConnected()) {
      setNativeHelperStatus('not_installed');
      return false;
    }
    await new Promise<void>((r) => setTimeout(r, 150));
    if (await tryPing()) return true;

    setNativeHelperStatus('error', 'Native host is not connected');
    nativeAudio.disconnect();
    return false;
  })();

  try {
    return await nativeConnectInFlight;
  } finally {
    nativeConnectInFlight = null;
  }
}

async function pingNativeHost(): Promise<void> {
  const ok = await ensureNativeConnected();
  if (ok) {
    bgLog('info', 'native host connected');
    return;
  }
  bgLog('warn', 'native host not reachable');
}

async function doCleanupNativeAudio(): Promise<void> {
  if (!nativeAudio.isConnected()) return;
  try {
    await nativeAudio.stopMirror().catch(() => undefined);
    await nativeAudio.cleanup().catch(() => undefined);
    bgLog('info', 'native audio cleaned up');
  } catch (err) {
    bgLog('warn', `cleanup error: ${describeNativeError(err)}`);
  } finally {
    nativeAudio.disconnect();
    // Reset status to 'unknown' so the next recording knows it must reconnect.
    // Without this the status stays 'connected' while the port is null, which
    // causes NOT_CONNECTED on the very next prepareApplicationAudio call.
    setNativeHelperStatus('unknown');
    clearAudioSession();
  }
}

// ---------------------------------------------------------------------------
// Offscreen document handshake
// ---------------------------------------------------------------------------

const offscreenManager = new OffscreenManager();
const cameraManager = new CameraManager(() => {
  includeCam = false;
  broadcastState();
});
const downloadService = new DownloadService((error?: string, targetSessionId?: string) => {
  recordingState = 'idle';
  duration = 0;
  currentError = error ?? null;
  currentSourceTabId = null;
  broadcastState();
  broadcastBubbleRefresh();
  cameraManager.cleanup();
  void offscreenManager.closeDocument();
  void doCleanupNativeAudio();
  if (targetSessionId) {
    deleteIndexedDBSession(targetSessionId).catch((err) => {
      bgLog('error', `Failed to delete IndexedDB session chunks: ${err}`);
    });
  }
});

const CAPTURE_START_TIMEOUT_MS = 90_000;
let captureWatchdog: ReturnType<typeof setTimeout> | null = null;
let offscreenWatchdog: ReturnType<typeof setInterval> | null = null;

function startOffscreenWatchdog(): void {
  stopOffscreenWatchdog();
  offscreenWatchdog = setInterval(async () => {
    if (recordingState !== 'recording' && recordingState !== 'paused') {
      stopOffscreenWatchdog();
      return;
    }
    const alive = await offscreenManager.ping();
    if (!alive) {
      bgLog('error', 'Offscreen watchdog detected offscreen document crash/removal!');
      void handleOffscreenCrash();
    }
  }, 8000);
}

function stopOffscreenWatchdog(): void {
  if (offscreenWatchdog !== null) {
    clearInterval(offscreenWatchdog);
    offscreenWatchdog = null;
  }
}

async function handleOffscreenCrash(): Promise<void> {
  stopOffscreenWatchdog();
  bgLog('warn', 'handling offscreen crash recovery');
  
  try {
    const result = await chrome.storage.local.get(['activeSession']);
    const activeSession = result.activeSession as any;
    if (activeSession && activeSession.sessionId === currentSessionId) {
      activeSession.status = 'crashed';
      activeSession.lastUpdateTime = Date.now();
      await chrome.storage.local.set({ activeSession });
    }
  } catch (err) {
    bgLog('error', `watchdog recovery storage update failed: ${err}`);
  }

  currentSessionId = null;
  clearCaptureWatchdog();
  recordingState = 'interrupted';
  currentError = 'Recording was interrupted due to offscreen document crash.';
  broadcastState();
  
  tabFocusDetector.stop();
  currentSourceTabId = null;
  broadcastBubbleRefresh();
  cameraManager.cleanup();
  await offscreenManager.closeDocument();
  await doCleanupNativeAudio();
}

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
    if (recordingState !== 'starting') return;
    bgLog('warn', 'capture watchdog fired — resetting');
    chrome.storage.local.remove('activeSession').catch(() => undefined);
    currentSessionId = null;
    recordingState = 'idle';
    duration = 0;
    currentError =
      'Capture did not start. No source was selected, or the screen dialog was blocked. Please try again.';
    broadcastState();
    tabFocusDetector.stop();
    currentSourceTabId = null;
    broadcastBubbleRefresh();
    cameraManager.cleanup();
    void offscreenManager.closeDocument();
    void doCleanupNativeAudio();
  }, CAPTURE_START_TIMEOUT_MS);
}

const tabFocusDetector = new TabFocusDetector((tabId) => {
  void switchRecordingSource(tabId);
});

// ---------------------------------------------------------------------------
// State broadcasting
// ---------------------------------------------------------------------------

function getStatusPayload(): RecordingStatusPayload {
  return {
    recordingState,
    duration,
    error: currentError,
    includeMic,
    includeCam,
    focusMode,
    audioSettings,
    appAudio: appAudioState,
  };
}

function broadcastState(): void {
  void syncStateToStorage();
  chrome.runtime
    .sendMessage({ type: 'STATE_CHANGED', state: getStatusPayload() })
    .catch(() => undefined);
}

function broadcastBubbleRefresh(): void {
  chrome.tabs.query({}, (tabs) => {
    for (const tab of tabs) {
      if (tab.id != null && tab.id >= 0) {
        chrome.tabs.sendMessage(tab.id, { type: 'BUBBLE_REFRESH' }).catch(() => undefined);
      }
    }
  });
}

// ---------------------------------------------------------------------------
// defineBackground entry point
// ---------------------------------------------------------------------------

export default defineBackground(() => {
  offscreenManager.resetReadyPromise();
  nativeAudio.connect(onNativeHostDisconnect);

  void hydrateStateFromStorage().then(async () => {
    bgLog('info', `Hydrated state from session storage: ${recordingState}`);
    try {
      const result = await chrome.storage.local.get(['activeSession']);
      const activeSession = result.activeSession as any;
      if (activeSession) {
        if (activeSession.status === 'recording' || activeSession.status === 'paused') {
          // Verify if offscreen is actually alive
          const offscreenState = await offscreenManager.ping();
          if (offscreenState) {
            bgLog('info', `Detected active offscreen recording session: ${activeSession.sessionId}. Restoring state.`);
            currentSessionId = activeSession.sessionId;
            recordingState = offscreenState.state;
            duration = offscreenState.duration;
            focusMode = activeSession.focusMode;
            includeMic = activeSession.includeMic;
            includeCam = activeSession.includeCam;
            broadcastState();
          } else {
            // Offscreen did not respond - check heartbeat
            const HEARTBEAT_TIMEOUT_MS = 15000; // 15 seconds
            if (Date.now() - activeSession.lastUpdateTime > HEARTBEAT_TIMEOUT_MS) {
              bgLog('warn', `Detected crashed recording session: ${activeSession.sessionId}`);
              activeSession.status = 'crashed';
              await chrome.storage.local.set({ activeSession });
              recordingState = 'interrupted';
              currentError = 'Recording was interrupted due to a crash or reload.';
              broadcastState();
            } else {
              // Heartbeat is fresh, offscreen might be loading, restore state
              bgLog('info', `Heartbeat fresh for session: ${activeSession.sessionId}. Restoring state.`);
              currentSessionId = activeSession.sessionId;
              recordingState = activeSession.status;
              duration = activeSession.duration;
              focusMode = activeSession.focusMode;
              includeMic = activeSession.includeMic;
              includeCam = activeSession.includeCam;
              broadcastState();
            }
          }
        } else if (activeSession.status === 'crashed') {
          bgLog('warn', `Detected interrupted recording session: ${activeSession.sessionId}`);
          recordingState = 'interrupted';
          currentError = 'Recording was interrupted due to a crash or reload.';
          broadcastState();
        }
      }
    } catch (err) {
      bgLog('error', `Failed to check for interrupted session: ${err}`);
    }
  });

  // Open the side panel whenever the user clicks the toolbar action icon.
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch(() => undefined);

  // Context menu to arm the current tab for Focus recording.
  chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.removeAll(() => {
      chrome.contextMenus.create({
        id: ARM_MENU_ID,
        title: 'Add this tab to Focus recording',
        contexts: ['page', 'action'],
      });
    });
    // Ping native host shortly after install / service-worker restart.
    setTimeout(() => void pingNativeHost(), 800);
  });

  // Ping once when the service worker starts (onInstalled also schedules one on fresh install).
  setTimeout(() => void pingNativeHost(), 800);

  chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === ARM_MENU_ID) armCurrentTab(tab);
  });

  chrome.commands.onCommand.addListener((command) => {
    if (command === ARM_MENU_ID) armCurrentTab();
  });

  chrome.windows.onRemoved.addListener((windowId) => {
    cameraManager.handleWindowRemoved(windowId);
  });

  chrome.tabs.onRemoved.addListener((tabId) => {
    if (recordingState === 'recording' || recordingState === 'paused') {
      if (tabId === currentSourceTabId) {
        bgLog('warn', `Recorded tab ${tabId} was closed!`);
        chrome.runtime.sendMessage({
          type: 'RECORDED_TAB_CLOSED',
          tabId
        }).catch(() => undefined);
      }
    }
  });

  // Best-effort cleanup when the service worker is about to be suspended.
  chrome.runtime.onSuspend.addListener(() => {
    bgLog('info', 'service worker suspending — cleaning up');
    stopOffscreenWatchdog();
    void doCleanupNativeAudio();
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    switch (message.type) {

      // ---- Popup/SidePanel commands -----------------------------------------

      case 'START_RECORDING_FLOW':
        includeMic = message.includeMic;
        includeCam = message.includeCam;
        focusMode = message.focusMode ?? false;
        audioSettings = message.audioSettings ?? { ...DEFAULT_AUDIO_SETTINGS };
        startRecordingFlow(message.startingTabId);
        sendResponse({ success: true });
        break;

      case 'RESUME_INTERRUPTED_SESSION':
        resumeRecordingFlow().then(() => sendResponse({ success: true }));
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

      case 'UPDATE_AUDIO_SETTINGS':
        audioSettings = message.audioSettings;
        void syncStateToStorage();
        chrome.runtime.sendMessage({
          type: 'UPDATE_AUDIO_SETTINGS',
          audioSettings
        }).catch(() => undefined);
        sendResponse({ success: true });
        break;

      case 'GET_RECORDING_STATUS':
        sendResponse(getStatusPayload());
        break;

      case 'GET_LOG_BUFFER':
        sendResponse({ lines: logBuffer });
        break;

      case 'GET_TELEMETRY':
        sendResponse({ telemetry: telemetryBuffer });
        break;

      // ---- Focus 1-1 / bubble -----------------------------------------------

      case 'GET_BUBBLE_STATUS': {
        const senderTabId = _sender.tab?.id ?? null;
        const senderUrl = _sender.tab?.url ?? '';
        const focusActive =
          (recordingState === 'recording' || recordingState === 'paused') && focusMode;
        sendResponse({
          active: focusActive,
          paused: recordingState === 'paused',
          duration,
          armed: senderTabId != null && tabFocusDetector.isMonitored(senderTabId),
          isCurrent: senderTabId != null && senderTabId === currentSourceTabId,
          capturable: /^https?:\/\//i.test(senderUrl),
        });
        break;
      }

      case 'GET_TAB_ARMED':
        sendResponse({ armed: tabFocusDetector.isMonitored(message.tabId) });
        break;

      case 'ARM_CURRENT_TAB':
        if (message.tabId != null) {
          chrome.tabs.get(message.tabId, (t) => {
            if (chrome.runtime.lastError || !t) {
              sendResponse({ success: false, error: 'Tab not found' });
            } else {
              armCurrentTab(t);
              sendResponse({ success: true });
            }
          });
          return true; // keep channel open for async response
        } else {
          armCurrentTab();
          sendResponse({ success: true });
        }
        break;

      // ---- Offscreen events -------------------------------------------------

      case 'OFFSCREEN_READY':
        offscreenManager.resolveReady();
        sendResponse({ success: true });
        break;

      case 'DISPLAY_SURFACE_DETECTED':
        handleDisplaySurfaceDetected(
          message.surface as string,
          message.sourceLabel as string | undefined
        );
        if (currentSessionId) {
          chrome.storage.local.get(['activeSession'], (res) => {
            const activeSession = res.activeSession as any;
            if (activeSession && activeSession.sessionId === currentSessionId) {
              activeSession.captureSource = message.surface;
              chrome.storage.local.set({ activeSession }).catch(() => undefined);
            }
          });
        }
        sendResponse({ success: true });
        break;

      case 'CAPTURE_STARTED':
        clearCaptureWatchdog();
        recordingState = 'recording';
        duration = 0;
        broadcastState();
        startOffscreenWatchdog();
        if (focusMode && focusStartTabId) {
          tabFocusDetector.start([focusStartTabId]);
          currentSourceTabId = focusStartTabId;
        }
        if (currentSessionId) {
          chrome.storage.local.get(['activeSession'], (res) => {
            const activeSession = res.activeSession as any;
            if (activeSession && activeSession.sessionId === currentSessionId) {
              activeSession.startTime = Date.now();
              activeSession.lastUpdateTime = Date.now();
              activeSession.status = 'recording';
              chrome.storage.local.set({ activeSession }).catch(() => undefined);
            }
          });
        }
        broadcastBubbleRefresh();
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

      case 'STREAM_HEALTH_EVENT':
        telemetryLog(message.event, { trackId: message.trackId });
        if (message.event === 'VIDEO_SOURCE_LOST') {
          currentError = 'Video source was lost. Recording continues with placeholder.';
          broadcastState();
        }
        sendResponse({ success: true });
        break;

      case 'AUDIO_HEALTH_EVENT':
        telemetryLog(message.event, { trackId: message.trackId });
        sendResponse({ success: true });
        break;

      case 'VIDEO_SOURCE_LOST':
        telemetryLog('VIDEO_SOURCE_LOST');
        currentError = 'Video source was lost. Recording continues with placeholder.';
        broadcastState();
        sendResponse({ success: true });
        break;

      case 'RECORDING_WARNING':
        currentError = message.warning;
        bgLog('warn', message.warning);
        broadcastState();
        sendResponse({ success: true });
        break;

      case 'ATTACH_APP_AUDIO_FAILED':
        bgLog('warn', `virtual device attach failed: ${message.warning}`);
        setAudioSessionStatus('error', {
          error: message.warning ?? 'Virtual audio device could not be attached',
        });
        currentError = message.warning ?? null;
        broadcastState();
        scheduleAttachAppAudioRetry();
        sendResponse({ success: true });
        break;

      case 'AUDIO_DEVICE_INVENTORY': {
        const devs =
          (message.devices as Array<{ deviceId: string; label: string; groupId: string }> | undefined) ??
          [];
        const target = message.captureTarget as VirtualCaptureTarget | undefined;
        bgLog('info', `Chrome audioinput count: ${devs.length}`);
        for (const d of devs) {
          bgLog(
            'info',
            `  audioinput id="${d.deviceId}" label="${d.label || '(empty)'}" group="${d.groupId || ''}"`
          );
        }
        if (target) {
          bgLog(
            'info',
            `native capture target: sourceName="${target.sourceName}" sink="${target.sinkName}" pulseIndex=${target.pulseSourceIndex ?? 'n/a'}`
          );
        }
        sendResponse({ success: true });
        break;
      }

      case 'ATTACH_APP_AUDIO_SUCCEEDED':
        attachAppAudioRetryCount = 0;
        if (appAudioState.sessionStatus === 'error') {
          setAudioSessionStatus(appAudioState.mirrors.length ? 'mirroring' : 'virtual_device_ready', {
            error: null,
          });
        }
        bgLog('info', 'virtual audio device attached in offscreen');
        sendResponse({ success: true });
        break;

      case 'ATTACH_APP_AUDIO_VALIDATED': {
        const v = message.validation as {
          deviceId?: string;
          label?: string;
          readyState?: string;
          chromeCaptureSource?: string;
          rms?: number;
          hasSignal?: boolean;
        };
        bgLog(
          'info',
          `attach validated: deviceId="${v.deviceId ?? ''}" label="${v.label ?? ''}" rms=${v.rms?.toFixed(6) ?? 'n/a'} hasSignal=${v.hasSignal ?? false}`
        );
        sendResponse({ success: true });
        break;
      }

      case 'RETRY_ATTACH_APP_AUDIO':
        void sendAttachAppAudioToOffscreen().then(() => sendResponse({ success: true }));
        break;

      case 'RECORDING_ERROR':
        stopOffscreenWatchdog();
        chrome.storage.local.remove('activeSession').catch(() => undefined);
        currentSessionId = null;
        clearCaptureWatchdog();
        currentError = message.error;
        bgLog('error', `recording error: ${message.error}`);
        recordingState = 'idle';
        duration = 0;
        broadcastState();
        tabFocusDetector.stop();
        currentSourceTabId = null;
        broadcastBubbleRefresh();
        cameraManager.cleanup();
        void offscreenManager.closeDocument();
        void doCleanupNativeAudio();
        sendResponse({ success: true });
        break;

      case 'RECORDING_COMPLETE':
        stopOffscreenWatchdog();
        chrome.storage.local.remove('activeSession').catch(() => undefined);
        currentSessionId = null;
        tabFocusDetector.stop();
        bgLog('info', `RECORDING_COMPLETE mimeType=${message.mimeType} sessionId=${message.sessionId}`);
        const streamUrl = chrome.runtime.getURL(`/stream-download?sessionId=${message.sessionId}&mimeType=${encodeURIComponent(message.mimeType)}`);
        downloadService.download(message.blobUrl || streamUrl, message.mimeType, message.sessionId);
        sendResponse({ success: true });
        break;

      // ---- Native audio commands (from SidePanel) ---------------------------

      case 'NATIVE_PING':
        (async () => {
          await pingNativeHost();
          sendResponse({ success: true, state: getStatusPayload() });
        })();
        break;

      case 'NATIVE_LIST_APPS':
        (async () => {
          try {
            if (!(await ensureNativeConnected())) throw new Error('Native host not connected');
            const apps = await nativeAudio.listApplications();
            sendResponse({ success: true, apps });
          } catch (err) {
            sendResponse({ success: false, error: describeNativeError(err) });
          }
        })();
        break;

      case 'NATIVE_DIAGNOSE_CAPTURE':
        (async () => {
          try {
            if (!(await ensureNativeConnected())) throw new Error('Native host not connected');
            const diagnosis = await nativeAudio.diagnoseCaptureGraph();
            bgLog('info', `diagnoseCaptureGraph: ${JSON.stringify(diagnosis.comparisonTable)}`);
            for (const row of diagnosis.comparisonTable) {
              bgLog(
                'info',
                `  pactl ${row.pulseName}#${row.index} monitor=${row.isMonitor} chromeVisible=${row.chromeVisible}`
              );
            }
            sendResponse({ success: true, diagnosis });
          } catch (err) {
            sendResponse({ success: false, error: describeNativeError(err) });
          }
        })();
        break;

      case 'MIRROR_APP_AUDIO':
        (async () => {
          try {
            if (!(await ensureNativeConnected())) throw new Error('Native host not connected');
            const appName = (message.appName as string | undefined) ?? `pid ${message.pid}`;
            const sessionName = currentAudioSessionName ?? appName;
            const sinkName = currentAudioSinkName ?? deriveSinkName(sessionName);
            const result = await nativeAudio.mirrorApplicationAudio(Number(message.pid), {
              sessionName,
              sinkName,
            });
            const session: AudioSession = {
              pid: result.pid,
              name: message.appName ?? `pid ${result.pid}`,
              nodeIds: result.nodeIds,
              linksCreated: result.linksCreated,
            };
            addMirror(session);
            if (!currentAudioSessionName) {
              currentAudioSessionName = sessionName;
              currentAudioSinkName = sinkName;
              nativeDeviceLabelHint = sessionName;
              setAudioSessionStatus(appAudioState.sessionStatus, {
                deviceLabelHint: sessionName,
              });
            }
            bgLog('info', `mirroring ${session.name} (pid ${session.pid}), links: ${session.linksCreated}`);
            sendResponse({ success: true });
          } catch (err) {
            const msg = describeNativeError(err);
            bgLog('error', `mirror failed: ${msg}`);
            setAudioSessionStatus('error', { error: msg });
            sendResponse({ success: false, error: msg });
          }
        })();
        break;

      case 'STOP_MIRROR_APP': {
        const pid = message.pid != null ? Number(message.pid) : undefined;
        (async () => {
          try {
            if (nativeAudio.isConnected()) await nativeAudio.stopMirror(pid);
            appAudioState = {
              ...appAudioState,
              mirrors: pid != null
                ? appAudioState.mirrors.filter((m) => m.pid !== pid)
                : [],
              sessionStatus: appAudioState.mirrors.length > 1 ? 'mirroring' : 'virtual_device_ready',
            };
            broadcastState();
            sendResponse({ success: true });
          } catch (err) {
            sendResponse({ success: false, error: describeNativeError(err) });
          }
        })();
        break;
      }

      // ---- Camera preview ---------------------------------------------------

      case 'CAMERA_WINDOW_CLOSED':
        cameraManager.cleanup();
        sendResponse({ success: true });
        break;

      case 'DISCARD_INTERRUPTED_SESSION':
        chrome.storage.local.remove('activeSession').then(() => {
          recordingState = 'idle';
          currentError = null;
          duration = 0;
          broadcastState();
          sendResponse({ success: true });
        }).catch((err) => {
          sendResponse({ success: false, error: err.message });
        });
        break;

      case 'RECOVERED_SESSION_SAVED':
        chrome.storage.local.remove('activeSession').then(() => {
          recordingState = 'idle';
          currentError = null;
          duration = 0;
          broadcastState();
          sendResponse({ success: true });
        }).catch((err) => {
          sendResponse({ success: false, error: err.message });
        });
        break;
    }

    return true; // keep channel open for async sendResponse
  });
});

// ---------------------------------------------------------------------------
// Offscreen handshake
// ---------------------------------------------------------------------------


// ---------------------------------------------------------------------------
// displaySurface detection — triggers native audio prep for app windows
// ---------------------------------------------------------------------------

function handleDisplaySurfaceDetected(surface: string, sourceLabel?: string): void {
  bgLog('info', `displaySurface detected: ${surface}${sourceLabel ? ` (${sourceLabel})` : ''}`);
  // Handle both 'window' (single app) and 'monitor' (entire screen).
  if (surface !== 'window' && surface !== 'monitor') return;
  if (nativeAudioPreparing) return;

  const sessionName = deriveSessionName(surface, sourceLabel);
  const sinkName = deriveSinkName(sessionName);

  nativeAudioPreparing = true;
  setAudioSessionStatus('preparing');

  void (async () => {
    try {
            if (!(await ensureNativeConnected())) {
        bgLog('warn', `${surface} capture: native host not connected — skipping audio prep`);
        setAudioSessionStatus('error', { error: 'Native host is not connected' });
        return;
      }

      const result = await nativeAudio.prepareApplicationAudio({ sessionName, sinkName });
      currentCaptureTarget = captureTargetFromPrepareResult(result, sessionName);
      currentAudioSessionName = sessionName;
      currentAudioSinkName = currentCaptureTarget.sinkName;
      currentAudioDeviceId = currentCaptureTarget.sourceName;
      nativeDeviceLabelHint = result.chromeLabelHint;
      setAudioSessionStatus('virtual_device_ready', {
        deviceLabelHint: result.chromeLabelHint,
        error: null,
      });
      bgLog('info', `prepareApplicationAudio: ${JSON.stringify(result)}`);
      bgLog(
        'info',
        `chromeCaptureSource=${currentCaptureTarget.chromeCaptureSource} (not ${currentCaptureTarget.monitorSource})`
      );
      if (result.pulseSources?.length) {
        bgLog(
          'info',
          `pactl sources: ${result.pulseSources.map((s) => `${s.name}#${s.index}[${s.state}]`).join(', ')}`
        );
      } else {
        bgLog('warn', 'pactl: no virtual audio sources listed');
      }

      try {
        const validation = await nativeAudio.validateCaptureDevice();
        bgLog(
          'info',
          `validateCaptureDevice: micPresent=${validation.micPresent} monitorPresent=${validation.monitorPresent} mic=${validation.chromeCaptureSource}`
        );
        if (!validation.micPresent) {
          bgLog('warn', 'remap mic source missing in pactl — Chrome will not see capture device');
        }
      } catch (err) {
        bgLog('warn', `validateCaptureDevice failed: ${describeNativeError(err)}`);
      }

      // Mirror app audio into the sink BEFORE Chrome opens the remap mic,
      // so the virtual device already carries signal when we attach.
      if (surface === 'monitor') {
        await autoMirrorAllStreams({ sessionName, sinkName });
      } else if (surface === 'window') {
        await autoMirrorByWindowTitle(sourceLabel ?? sessionName, { sessionName, sinkName });
      }

      // PipeWire + Chrome need a moment to expose the new remap mic source.
      await new Promise<void>((r) => setTimeout(r, 1200));

      await sendAttachAppAudioToOffscreen();
    } catch (err) {
      const msg = describeNativeError(err);
      bgLog('error', `prepareApplicationAudio failed: ${msg}`);
      setAudioSessionStatus('error', { error: msg });
    } finally {
      nativeAudioPreparing = false;
    }
  })();
}

/**
 * Try to match a PipeWire audio stream to the captured window title and mirror it.
 */
async function autoMirrorByWindowTitle(
  windowTitle: string,
  opts: { sessionName: string; sinkName: string }
): Promise<void> {
  if (isOpaqueWindowLabel(windowTitle)) {
    bgLog('info', `autoMirrorByWindowTitle: opaque id "${windowTitle}" — mirroring all streams`);
    return autoMirrorAllStreams(opts);
  }

  try {
    const apps = await nativeAudio.listApplications();
    if (!apps.length) {
      bgLog('info', 'autoMirrorByWindowTitle: no active audio streams');
      return;
    }

    const title = windowTitle.toLowerCase();
    const titleHead = title.split(' - ')[0]?.trim() ?? title;

    const scoreApp = (app: { name: string; binary: string }) => {
      const name = app.name.toLowerCase();
      const binary = app.binary.toLowerCase();
      if (title.includes(name) || name.includes(titleHead)) return 100;
      if (binary && (title.includes(binary) || titleHead.includes(binary))) return 90;
      if (titleHead && name.includes(titleHead)) return 70;
      return 0;
    };

    const ranked = apps
      .filter((a) => a.pid != null)
      .map((a) => ({ app: a, score: scoreApp(a) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score);

    if (!ranked.length) {
      bgLog('info', `autoMirrorByWindowTitle: no app matched "${windowTitle}" — mirror manually`);
      return;
    }

    const { app } = ranked[0];
    const result = await nativeAudio.mirrorApplicationAudio(app.pid!, opts);
    addMirror({
      pid: result.pid,
      name: app.name,
      nodeIds: result.nodeIds,
      linksCreated: result.linksCreated,
    });
    bgLog('info', `auto-mirrored window app ${app.name} (pid ${app.pid}), links: ${result.linksCreated}`);
  } catch (err) {
    bgLog('warn', `autoMirrorByWindowTitle failed: ${describeNativeError(err)}`);
  }
}

/**
 * Mirror every currently-playing audio stream into the virtual sink.
 * Used for "Entire Screen" recording where we want all app audio captured
 * without requiring the user to manually select individual applications.
 */
async function autoMirrorAllStreams(opts: { sessionName: string; sinkName: string }): Promise<void> {
  try {
    let discovered: Awaited<ReturnType<typeof nativeAudio.listApplications>> = [];
    try {
      discovered = await nativeAudio.listApplications();
      bgLog(
        'info',
        `autoMirrorAllStreams: discovered ${discovered.length} Stream/Output/Audio node(s)` +
          (discovered.length
            ? `: ${discovered.map((a) => `${a.name}(pid ${a.pid})`).join(', ')}`
            : '')
      );
    } catch (err) {
      bgLog('warn', `autoMirrorAllStreams: listApplications failed: ${describeNativeError(err)}`);
    }

    const result = await nativeAudio.mirrorAllApplications(opts);
    const { defaultOutput, mirrored, results } = result;

    if (defaultOutput.linksCreated > 0) {
      bgLog(
        'info',
        `autoMirrorAllStreams: default output mirrored (${defaultOutput.sourceSink} → ${opts.sinkName}), links=${defaultOutput.linksCreated}`
      );
    } else if (defaultOutput.error) {
      bgLog('warn', `autoMirrorAllStreams: default output mirror failed: ${defaultOutput.error}`);
    } else {
      bgLog('warn', 'autoMirrorAllStreams: default output mirror created 0 links');
    }

    for (const r of results) {
      const app = discovered.find((a) => a.pid === r.pid);
      addMirror({
        pid: r.pid,
        name: app?.name ?? `pid ${r.pid}`,
        nodeIds: r.nodeIds,
        linksCreated: r.linksCreated,
      });
      bgLog('info', `auto-mirrored app pid ${r.pid}, links: ${r.linksCreated}`);
    }

    bgLog(
      'info',
      `autoMirrorAllStreams done: defaultLinks=${defaultOutput.linksCreated}, appMirrored=${mirrored}`
    );
  } catch (err) {
    bgLog('warn', `autoMirrorAllStreams failed: ${describeNativeError(err)}`);
  }
}

// ---------------------------------------------------------------------------
// Recording lifecycle
// ---------------------------------------------------------------------------

function startRecordingFlow(startingTabId?: number): void {
  recordingState = 'starting';
  currentError = null;
  attachAppAudioRetryCount = 0;
  currentSessionId = `session-${Date.now()}`;
  focusStartTabId = focusMode ? (startingTabId ?? null) : null;

  // Save activeSession metadata immediately before starting MediaRecorder
  chrome.storage.local.set({
    activeSession: {
      sessionId: currentSessionId,
      startTime: Date.now(),
      mimeType: 'video/webm',
      duration: 0,
      focusMode,
      includeMic,
      includeCam,
      isActive: true,
      status: 'recording',
      lastChunkTime: Date.now(),
      lastUpdateTime: Date.now(),
      chunkCount: 0
    }
  }).catch(err => bgLog('error', `Failed to write initial activeSession: ${err}`));

  broadcastState();
  bgLog('info', `startRecordingFlow focusMode=${focusMode} mic=${includeMic} cam=${includeCam}`);

  void (async () => {
    try {
      await offscreenManager.ensureDocument();
      bgLog('info', 'offscreen ready');

      let initialStreamId: string | null = null;
      if (focusMode && startingTabId) {
        initialStreamId = await chrome.tabCapture.getMediaStreamId({
          targetTabId: startingTabId,
        });
        bgLog('info', `tab stream id acquired for tab ${startingTabId}`);
      }

      if (includeCam) await cameraManager.open();

      armCaptureWatchdog();

      const platformInfo = await chrome.runtime.getPlatformInfo();
      await chrome.runtime.sendMessage({
        type: 'START_RECORDING',
        includeMic,
        focusMode,
        audioSettings,
        initialStreamId,
        sessionId: currentSessionId,
        os: platformInfo.os,
      });
      bgLog('info', 'START_RECORDING sent to offscreen');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to initialize recording';
      bgLog('error', `start failed: ${msg}`);
      clearCaptureWatchdog();
      chrome.storage.local.remove('activeSession').catch(() => undefined);
      currentSessionId = null;
      recordingState = 'idle';
      currentError = msg;
      broadcastState();
      tabFocusDetector.stop();
      cameraManager.cleanup();
      await offscreenManager.closeDocument();
      await doCleanupNativeAudio();
    }
  })();
}

async function resumeRecordingFlow(): Promise<void> {
  try {
    const result = await chrome.storage.local.get(['activeSession']);
    const activeSession = result.activeSession as any;
    if (!activeSession) {
      throw new Error('No interrupted session found to resume');
    }

    recordingState = 'starting';
    currentError = null;
    attachAppAudioRetryCount = 0;
    currentSessionId = activeSession.sessionId;
    includeMic = activeSession.includeMic;
    includeCam = activeSession.includeCam;
    focusMode = activeSession.focusMode;
    duration = activeSession.duration || 0;
    broadcastState();

    await offscreenManager.ensureDocument();
    bgLog('info', `resuming recording session ${currentSessionId}`);

    let initialStreamId: string | null = null;
    if (focusMode) {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (activeTab?.id) {
        initialStreamId = await chrome.tabCapture.getMediaStreamId({
          targetTabId: activeTab.id,
        });
        focusStartTabId = activeTab.id;
      }
    }

    if (includeCam) await cameraManager.open();

    armCaptureWatchdog();

    // Update activeSession status to recording in local storage immediately
    activeSession.status = 'recording';
    activeSession.lastUpdateTime = Date.now();
    await chrome.storage.local.set({ activeSession });

    const platformInfo = await chrome.runtime.getPlatformInfo();
    await chrome.runtime.sendMessage({
      type: 'START_RECORDING',
      includeMic,
      focusMode,
      audioSettings,
      initialStreamId,
      sessionId: currentSessionId,
      isContinuation: true,
      initialDuration: duration,
      os: platformInfo.os,
    });
    bgLog('info', 'START_RECORDING (resume) sent to offscreen');
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to resume recording';
    bgLog('error', `resume failed: ${msg}`);
    clearCaptureWatchdog();
    recordingState = 'idle';
    currentError = msg;
    broadcastState();
    tabFocusDetector.stop();
    cameraManager.cleanup();
    await offscreenManager.closeDocument();
    await doCleanupNativeAudio();
  }
}

function stopRecordingFlow(): void {
  if (recordingState !== 'recording' && recordingState !== 'paused') return;

  recordingState = 'starting'; // renders "Saving…"
  broadcastState();
  tabFocusDetector.stop();
  bgLog('info', 'stopRecordingFlow');

  chrome.runtime.sendMessage({ type: 'STOP_RECORDING' }).catch(async (err) => {
    bgLog('error', `failed to send stop command: ${err}`);
    recordingState = 'idle';
    currentError = 'Failed to stop recording. Please try again.';
    broadcastState();
    cameraManager.cleanup();
    await offscreenManager.closeDocument();
    await doCleanupNativeAudio();
  });
}



// ---------------------------------------------------------------------------
// Focus 1-1 source switching
// ---------------------------------------------------------------------------

async function switchRecordingSource(tabId: number): Promise<void> {
  if (recordingState !== 'recording' && recordingState !== 'paused') return;
  try {
    const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
    await chrome.runtime.sendMessage({ type: 'SWITCH_SOURCE', streamId, tabId });
    currentSourceTabId = tabId;
    broadcastBubbleRefresh();
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'capture unavailable';
    bgLog('warn', `could not switch tab: ${msg}`);
    currentError = `Could not switch to tab: ${msg}`;
    broadcastState();
  }
}

const CAPTURABLE_TAB = /^https?:\/\//i;

function armCurrentTab(tab?: chrome.tabs.Tab): void {
  if (recordingState !== 'recording' && recordingState !== 'paused') {
    currentError = 'Start a Focus recording first, then arm tabs to follow.';
    broadcastState();
    return;
  }
  if (!focusMode) return;

  const resolve = (resolved?: chrome.tabs.Tab) => {
    if (!resolved?.id || !resolved.url || !CAPTURABLE_TAB.test(resolved.url)) {
      currentError = 'This tab cannot be recorded (only http/https pages).';
      broadcastState();
      return;
    }
    tabFocusDetector.addTab(resolved.id);
    currentError = null;
    void switchRecordingSource(resolved.id);
  };

  if (tab) {
    resolve(tab);
  } else {
    chrome.tabs.query({ active: true, currentWindow: true }, ([activeTab]) => resolve(activeTab));
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function describeNativeError(err: unknown): string {
  if (err && typeof err === 'object') {
    const e = err as { code?: string; message?: string };
    if (e.message) return e.code ? `${e.message} (${e.code})` : e.message;
  }
  return String(err);
}

// ---------------------------------------------------------------------------
// IndexedDB Stream-saving & Cleanup Helpers for SW
// ---------------------------------------------------------------------------

function getChunkFromIndexedDB(sessionId: string, index: number): Promise<Blob | null> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('RecordExtensionDB', 1);
    request.onsuccess = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('chunks')) {
        db.close();
        resolve(null);
        return;
      }
      try {
        const transaction = db.transaction('chunks', 'readonly');
        const store = transaction.objectStore('chunks');
        const key = `${sessionId}-${index}`;
        const getReq = store.get(key);
        getReq.onsuccess = () => {
          db.close();
          resolve(getReq.result || null);
        };
        getReq.onerror = () => {
          db.close();
          reject(getReq.error || new Error('failed to get chunk'));
        };
      } catch (err) {
        db.close();
        reject(err);
      }
    };
    request.onerror = () => {
      reject(request.error || new Error('failed to open db'));
    };
  });
}

function deleteIndexedDBSession(sessionId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('RecordExtensionDB', 1);
    request.onsuccess = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('chunks')) {
        db.close();
        resolve();
        return;
      }
      try {
        const transaction = db.transaction('chunks', 'readwrite');
        const store = transaction.objectStore('chunks');
        const range = IDBKeyRange.bound(`${sessionId}-0`, `${sessionId}-\uffff`);
        const cursorRequest = store.openCursor(range);
        
        cursorRequest.onsuccess = (event: any) => {
          const cursor = event.target.result;
          if (cursor) {
            store.delete(cursor.primaryKey);
            cursor.continue();
          } else {
            db.close();
            bgLog('info', `Successfully cleaned up IndexedDB session chunks for ${sessionId}`);
            resolve();
          }
        };
        
        cursorRequest.onerror = () => {
          db.close();
          reject(cursorRequest.error || new Error('cursor error'));
        };
      } catch (err) {
        db.close();
        reject(err);
      }
    };
    request.onerror = () => {
      reject(request.error || new Error('failed to open db'));
    };
  });
}

// Intercept stream download requests to prevent OOM
if (typeof self !== 'undefined' && typeof self.addEventListener === 'function') {
  self.addEventListener('fetch', (event: any) => {
    const url = new URL(event.request.url);
    if (url.pathname.endsWith('/stream-download')) {
      const sessionId = url.searchParams.get('sessionId');
      const mimeType = url.searchParams.get('mimeType') || 'video/webm';
      
      if (!sessionId) {
        event.respondWith(new Response('Missing sessionId', { status: 400 }));
        return;
      }

      const stream = new ReadableStream({
        async start(controller) {
          let index = 0;
          const readNext = async (): Promise<void> => {
            try {
              const chunk = await getChunkFromIndexedDB(sessionId, index);
              if (chunk) {
                const buffer = await chunk.arrayBuffer();
                controller.enqueue(new Uint8Array(buffer));
                index += 1;
                await readNext();
              } else {
                controller.close();
              }
            } catch (err) {
              console.error('[background] stream read error:', err);
              controller.error(err);
            }
          };
          await readNext();
        }
      });

      event.respondWith(new Response(stream, {
        headers: {
          'Content-Type': mimeType,
          'Content-Disposition': `attachment; filename="recording-${sessionId}.webm"`,
          'Cache-Control': 'no-cache'
        }
      }));
    }
  });
}
