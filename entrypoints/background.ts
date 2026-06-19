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

const LOG = '[background]';
const MAX_LOG_LINES = 100;

// ---------------------------------------------------------------------------
// Logging — all log lines also broadcast to the SidePanel.
// ---------------------------------------------------------------------------

const logBuffer: LogLine[] = [];

function bgLog(level: LogLine['level'], msg: string): void {
  console[level]?.(LOG, msg);
  const line: LogLine = { ts: Date.now(), level, msg };
  logBuffer.push(line);
  if (logBuffer.length > MAX_LOG_LINES) logBuffer.shift();
  chrome.runtime
    .sendMessage({ type: 'LOG_LINE', line })
    .catch(() => undefined);
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

const ARM_MENU_ID = 'arm-focus-tab';

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

let cameraWindowId: number | null = null;
let offscreenReadyResolve: (() => void) | null = null;
let offscreenReadyPromise: Promise<void> | null = null;

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
    if (recordingState !== 'starting') return;
    bgLog('warn', 'capture watchdog fired — resetting');
    recordingState = 'idle';
    duration = 0;
    currentError =
      'Capture did not start. No source was selected, or the screen dialog was blocked. Please try again.';
    broadcastState();
    tabFocusDetector.stop();
    currentSourceTabId = null;
    broadcastBubbleRefresh();
    cleanupCamera();
    void closeOffscreenDocument();
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
  resetOffscreenReadyPromise();
  nativeAudio.connect(onNativeHostDisconnect);

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
    if (cameraWindowId !== null && windowId === cameraWindowId) {
      cameraWindowId = null;
      includeCam = false;
      broadcastState();
    }
  });

  // Best-effort cleanup when the service worker is about to be suspended.
  chrome.runtime.onSuspend.addListener(() => {
    bgLog('info', 'service worker suspending — cleaning up');
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

      case 'GET_LOG_BUFFER':
        sendResponse({ lines: logBuffer });
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
        armCurrentTab();
        sendResponse({ success: true });
        break;

      // ---- Offscreen events -------------------------------------------------

      case 'OFFSCREEN_READY':
        resolveOffscreenReady();
        sendResponse({ success: true });
        break;

      case 'DISPLAY_SURFACE_DETECTED':
        handleDisplaySurfaceDetected(
          message.surface as string,
          message.sourceLabel as string | undefined
        );
        sendResponse({ success: true });
        break;

      case 'CAPTURE_STARTED':
        clearCaptureWatchdog();
        recordingState = 'recording';
        duration = 0;
        broadcastState();
        if (focusMode && focusStartTabId) {
          tabFocusDetector.start([focusStartTabId]);
          currentSourceTabId = focusStartTabId;
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
        clearCaptureWatchdog();
        currentError = message.error;
        bgLog('error', `recording error: ${message.error}`);
        recordingState = 'idle';
        duration = 0;
        broadcastState();
        tabFocusDetector.stop();
        currentSourceTabId = null;
        broadcastBubbleRefresh();
        cleanupCamera();
        void closeOffscreenDocument();
        void doCleanupNativeAudio();
        sendResponse({ success: true });
        break;

      case 'RECORDING_COMPLETE':
        handleRecordingComplete(message.url, message.mimeType);
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
        includeCam = false;
        cameraWindowId = null;
        broadcastState();
        sendResponse({ success: true });
        break;
    }

    return true; // keep channel open for async sendResponse
  });
});

// ---------------------------------------------------------------------------
// Offscreen handshake
// ---------------------------------------------------------------------------

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
    reasons: [
      chrome.offscreen.Reason.DISPLAY_MEDIA,
      chrome.offscreen.Reason.USER_MEDIA,
      chrome.offscreen.Reason.AUDIO_PLAYBACK,
    ],
    justification: 'Capture screen/tab/app audio, mix audio, and monitor to speakers',
  });

  await Promise.race([
    offscreenReadyPromise,
    new Promise<void>((_, reject) =>
      setTimeout(
        () => reject(new Error('Offscreen document did not become ready in time')),
        5000
      )
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
    const apps = await nativeAudio.listApplications();
    if (!apps.length) {
      bgLog('info', 'autoMirrorAllStreams: no active audio streams found');
      return;
    }
    for (const app of apps) {
      if (app.pid == null) continue;
      try {
        const result = await nativeAudio.mirrorApplicationAudio(app.pid, opts);
        const session: AudioSession = {
          pid: result.pid,
          name: app.name,
          nodeIds: result.nodeIds,
          linksCreated: result.linksCreated,
        };
        addMirror(session);
        bgLog('info', `auto-mirrored ${app.name} (pid ${app.pid}), links: ${result.linksCreated}`);
      } catch (err) {
        bgLog('warn', `autoMirrorAllStreams: skipping ${app.name} (pid ${app.pid}): ${describeNativeError(err)}`);
      }
    }
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
  focusStartTabId = focusMode ? (startingTabId ?? null) : null;
  broadcastState();
  bgLog('info', `startRecordingFlow focusMode=${focusMode} mic=${includeMic} cam=${includeCam}`);

  void (async () => {
    try {
      await ensureOffscreenDocument();
      bgLog('info', 'offscreen ready');

      let initialStreamId: string | null = null;
      if (focusMode && startingTabId) {
        initialStreamId = await chrome.tabCapture.getMediaStreamId({
          targetTabId: startingTabId,
        });
        bgLog('info', `tab stream id acquired for tab ${startingTabId}`);
      }

      if (includeCam) await openCameraPreview();

      armCaptureWatchdog();

      await chrome.runtime.sendMessage({
        type: 'START_RECORDING',
        includeMic,
        focusMode,
        audioSettings,
        initialStreamId,
      });
      bgLog('info', 'START_RECORDING sent to offscreen');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to initialize recording';
      bgLog('error', `start failed: ${msg}`);
      clearCaptureWatchdog();
      recordingState = 'idle';
      currentError = msg;
      broadcastState();
      tabFocusDetector.stop();
      cleanupCamera();
      await closeOffscreenDocument();
      await doCleanupNativeAudio();
    }
  })();
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
    cleanupCamera();
    await closeOffscreenDocument();
    await doCleanupNativeAudio();
  });
}

function handleRecordingComplete(blobUrl: string, mimeType: string): void {
  tabFocusDetector.stop();
  bgLog('info', `RECORDING_COMPLETE mimeType=${mimeType} hasUrl=${Boolean(blobUrl)}`);

  const finish = (error?: string) => {
    recordingState = 'idle';
    duration = 0;
    currentError = error ?? null;
    currentSourceTabId = null;
    broadcastState();
    broadcastBubbleRefresh();
    cleanupCamera();
    void closeOffscreenDocument();
    void doCleanupNativeAudio();
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
      finish(`Download failed: ${chrome.runtime.lastError?.message || 'unknown error'}`);
      return;
    }
    bgLog('info', `download started id=${downloadId} file=${filename}`);

    let settled = false;
    const settle = (error?: string) => {
      if (settled) return;
      settled = true;
      chrome.downloads.onChanged.removeListener(onChanged);
      finish(error);
    };

    const onChanged = (delta: chrome.downloads.DownloadDelta) => {
      if (delta.id !== downloadId || !delta.state) return;
      if (delta.state.current === 'complete') settle();
      else if (delta.state.current === 'interrupted')
        settle('Download was interrupted before completing.');
    };
    chrome.downloads.onChanged.addListener(onChanged);

    chrome.downloads.search({ id: downloadId }, (items) => {
      const item = items?.[0];
      if (item?.state === 'complete') settle();
      else if (item?.state === 'interrupted')
        settle('Download was interrupted before completing.');
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
// Camera preview
// ---------------------------------------------------------------------------

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
    bgLog('warn', `failed to open camera preview: ${err}`);
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
