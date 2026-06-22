import { mixAudioStreams } from '../../utils/audioMixer';
import {
  findNovelChromeCaptureInputs,
  formatAudioInputsForLog,
  logChromeAudioInputsTable,
  selectChromeCaptureDevice,
  verifyOpenedCaptureTrack,
  type ChromeAudioInputInfo,
  type VirtualCaptureTarget,
} from '../../utils/virtualCaptureDevice';
import { CanvasRouter } from '../../utils/canvasRouter';
import { ScreenRecorder } from '../../utils/recording';
import { DEFAULT_AUDIO_SETTINGS, type AudioMixSettings } from '../../utils/types';
import { StreamHealthMonitor, type StreamHealthEvent } from '../../utils/streamHealthMonitor';
import { AudioHealthMonitor, type AudioHealthEvent } from '../../utils/audioHealthMonitor';
import { ChunkStorage } from '../../utils/chunkStorage';
import { RECORDING_LIMITS } from '../../utils/recordingLimits';


let recorder: ScreenRecorder | null = null;
let canvasRouter: CanvasRouter | null = null;
let currentBlobUrl: string | null = null;
let screenStream: MediaStream | null = null;
let micStream: MediaStream | null = null;
let appAudioStream: MediaStream | null = null;
let mixAudioContext: AudioContext | null = null;
/** displaySurface value from the last getDisplayMedia call ('window'|'monitor'|'browser'|undefined). */
let detectedSurface: string | undefined;
/** audioinput deviceIds present before native sink creation — for diff matching. */
let baselineAudioDeviceIds = new Set<string>();

let streamMonitor: StreamHealthMonitor | null = null;
let audioMonitor: AudioHealthMonitor | null = null;
let micSourceNode: MediaStreamAudioSourceNode | null = null;
let micGainNode: GainNode | null = null;
let systemSourceNode: MediaStreamAudioSourceNode | null = null;
let systemGainNode: GainNode | null = null;
let compressorNode: DynamicsCompressorNode | null = null;
let dummyOscillatorNode: OscillatorNode | null = null;
let dummyGainNode: GainNode | null = null;

chrome.runtime.sendMessage({ type: 'OFFSCREEN_READY' }).catch(() => undefined);

recorder = new ScreenRecorder({
  onRecordingReady: async (sessionId, mimeType, stopReason) => {
    try {
      console.log('[offscreen] assembling final blob for session:', sessionId);
      const storage = new ChunkStorage();
      await storage.initExisting(sessionId);
      const blob = await storage.assembleBlob(mimeType);
      console.log('[offscreen] blob assembled, size:', blob.size);

      if (blob.size > 0) {
        const blobUrl = URL.createObjectURL(blob);
        chrome.runtime.sendMessage({
          type: 'RECORDING_COMPLETE',
          sessionId,
          mimeType,
          blobUrl,
          stopReason,
        });
      } else {
        throw new Error('Assembled blob is empty');
      }
    } catch (err: any) {
      console.error('[offscreen] failed to assemble blob:', err);
      chrome.runtime.sendMessage({
        type: 'RECORDING_ERROR',
        error: `Failed to assemble recording: ${err.message || String(err)}`,
      });
    }
  },
  onTimeUpdate: (seconds) => {
    chrome.runtime.sendMessage({ type: 'RECORDING_TICK', duration: seconds });
  },
  onError: (error) => {
    console.error('[offscreen] recording error:', error);
    chrome.runtime.sendMessage({ type: 'RECORDING_ERROR', error: error.message });
  },
  onStateChange: (state) => {
    chrome.runtime.sendMessage({
      type: state === 'paused' ? 'RECORDING_PAUSED' : 'RECORDING_RESUMED',
    });
  },
  onLimitEvent: (event, elapsedMs, message) => {
    chrome.runtime.sendMessage({
      type: 'RECORDING_LIMIT_EVENT',
      payload: {
        event,
        elapsedMs,
        remainingMs: RECORDING_LIMITS.maxDurationMs - elapsedMs,
        remainingToMaxMs: RECORDING_LIMITS.maxDurationMs - elapsedMs,
        message,
      }
    }).catch(() => undefined);
  },
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  switch (message.type) {
    case 'OFFSCREEN_PING':
      sendResponse({
        state: recorder?.getState() || 'inactive',
        duration: recorder?.getDurationSec() || 0
      });
      break;
    case 'START_RECORDING':
      void startCapture(message);
      sendResponse({ success: true });
      break;
    case 'STOP_RECORDING':
      void stopCapture(message.reason).then(() => sendResponse({ success: true }));
      return true;
    case 'USER_CHOSE_CONTINUE_TO_MAX':
      recorder?.confirmDurationExtension();
      sendResponse({ success: true });
      break;
    case 'PAUSE_RECORDING':
      recorder?.pause();
      sendResponse({ success: true });
      break;
    case 'RESUME_RECORDING':
      recorder?.resume();
      sendResponse({ success: true });
      break;
    case 'SWITCH_SOURCE':
      void switchSource(message.streamId);
      sendResponse({ success: true });
      break;
    // Background sends this after prepareApplicationAudio succeeds.
    // We switch the app-audio stream to use the virtual device.
    case 'ATTACH_APP_AUDIO':
      void attachAppAudio(message.captureTarget as VirtualCaptureTarget);
      sendResponse({ success: true });
      break;
    case 'FALLBACK_TO_DISPLAY_MEDIA':
      void fallbackToDisplayMedia();
      sendResponse({ success: true });
      break;
    case 'UPDATE_AUDIO_SETTINGS': {
      const settings = message.audioSettings as AudioMixSettings;
      if (mixAudioContext && mixAudioContext.state !== 'closed') {
        const now = mixAudioContext.currentTime;
        if (micGainNode) {
          micGainNode.gain.setValueAtTime(micGainNode.gain.value, now);
          micGainNode.gain.linearRampToValueAtTime(settings.micGain, now + 0.1);
        }
        if (systemGainNode) {
          systemGainNode.gain.setValueAtTime(systemGainNode.gain.value, now);
          systemGainNode.gain.linearRampToValueAtTime(settings.systemGain, now + 0.1);
        }
      }
      sendResponse({ success: true });
      break;
    }
    case 'CLEANUP_SESSION_STORAGE': {
      const storage = new ChunkStorage();
      storage.initExisting(message.sessionId)
        .then(() => storage.cleanup())
        .then(() => sendResponse({ success: true }))
        .catch((err) => {
          console.error('[offscreen] failed to cleanup session storage:', err);
          sendResponse({ success: false, error: err.message });
        });
      return true;
    }
  }
  return true;
});

// ---------------------------------------------------------------------------
// Tab stream capture (Focus 1-1 mode)
// ---------------------------------------------------------------------------

async function captureTabStream(streamId: string, withAudio: boolean): Promise<MediaStream> {
  const videoConstraints = {
    mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId },
  } as MediaTrackConstraints;
  const audioConstraints = {
    mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId },
  } as MediaTrackConstraints;

  if (withAudio) {
    try {
      return await navigator.mediaDevices.getUserMedia({
        audio: audioConstraints,
        video: videoConstraints,
      } as MediaStreamConstraints);
    } catch (err: any) {
      console.warn('[offscreen] tab audio unavailable, video only:', err?.name, err?.message);
      chrome.runtime.sendMessage({
        type: 'RECORDING_WARNING',
        warning: 'Tab audio unavailable. Recording video only from this tab.',
      });
    }
  }
  return navigator.mediaDevices.getUserMedia({
    audio: false,
    video: videoConstraints,
  } as MediaStreamConstraints);
}

// ---------------------------------------------------------------------------
// Virtual audio device attachment (baseline diff — Chrome opaque deviceIds)
// ---------------------------------------------------------------------------

const AUDIO_CAPTURE_OPTS: MediaTrackConstraints = {
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
};

async function snapshotBaselineAudioDevices(): Promise<void> {
  const devices = await navigator.mediaDevices.enumerateDevices();
  baselineAudioDeviceIds = new Set(
    devices.filter((d) => d.kind === 'audioinput').map((d) => d.deviceId)
  );
  console.log(
    '[offscreen] baseline audioinput deviceIds:',
    [...baselineAudioDeviceIds].join(', ') || '(none)'
  );
}

/** Offscreen must grant mic once so enumerateDevices() exposes deviceIds. */
async function primeOffscreenAudioPermission(): Promise<void> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { ...AUDIO_CAPTURE_OPTS } });
    stream.getTracks().forEach((t) => t.stop());
    console.log('[offscreen] audio permission primed');
  } catch (err: unknown) {
    const name = err instanceof DOMException ? err.name : '';
    if (name !== 'NotFoundError' && name !== 'NotAllowedError' && name !== 'NotReadableError') {
      console.warn('[offscreen] audio permission primer:', name);
    } else {
      console.log('[offscreen] audio permission primer bypassed/not readable (mic may be disabled or occupied):', name);
    }
  }
}

function waitForDeviceChange(timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      navigator.mediaDevices.removeEventListener('devicechange', onChange);
      resolve();
    };
    const timer = setTimeout(finish, timeoutMs);
    const onChange = () => finish();
    navigator.mediaDevices.addEventListener('devicechange', onChange);
  });
}

function waitForAppAudioStream(timeoutMs: number): Promise<boolean> {
  if (appAudioStream) return Promise.resolve(true);
  return new Promise((resolve) => {
    const deadline = setTimeout(() => {
      clearInterval(poll);
      resolve(Boolean(appAudioStream));
    }, timeoutMs);
    const poll = setInterval(() => {
      if (appAudioStream) {
        clearInterval(poll);
        clearTimeout(deadline);
        resolve(true);
      }
    }, 100);
  });
}

function reportAudioDeviceInventory(target: VirtualCaptureTarget): void {
  void navigator.mediaDevices.enumerateDevices().then((devices) => {
    const audioInputs = devices.filter((d) => d.kind === 'audioinput');
    const novel = audioInputs.filter((d) => !baselineAudioDeviceIds.has(d.deviceId));
    console.log('[offscreen] AUDIO_DEVICE_INVENTORY:', formatAudioInputsForLog(devices));
    console.log(
      `[offscreen] novel audioinputs since baseline: ${novel.length}`,
      novel.map((d) => d.deviceId)
    );
    chrome.runtime
      .sendMessage({
        type: 'AUDIO_DEVICE_INVENTORY',
        captureTarget: target,
        novelCount: novel.length,
        devices: audioInputs.map((d) => ({
          deviceId: d.deviceId,
          label: d.label,
          groupId: d.groupId,
          isNovel: !baselineAudioDeviceIds.has(d.deviceId),
        })),
      })
      .catch(() => undefined);
  });
}

/** Sample RMS level to confirm the capture track is not silent. */
async function measureAudioRms(track: MediaStreamTrack, ms = 300): Promise<number> {
  const ctx = new AudioContext();
  try {
    if (ctx.state === 'suspended') {
      await ctx.resume().catch(() => undefined);
    }
    const stream = new MediaStream([track]);
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    source.connect(analyser);
    const data = new Float32Array(analyser.fftSize);
    await new Promise<void>((r) => setTimeout(r, ms));
    analyser.getFloatTimeDomainData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
    return Math.sqrt(sum / data.length);
  } finally {
    await ctx.close().catch(() => undefined);
  }
}

async function logAttachValidation(
  track: MediaStreamTrack,
  target: VirtualCaptureTarget
): Promise<void> {
  const settings = track.getSettings() as MediaTrackSettings & { deviceId?: string };
  const rms = await measureAudioRms(track).catch(() => -1);
  const payload = {
    deviceId: settings.deviceId,
    label: track.label,
    readyState: track.readyState,
    chromeCaptureSource: target.chromeCaptureSource,
    rms,
    hasSignal: rms > 0.0001,
  };
  console.log('[offscreen] attach validation:', payload);
  chrome.runtime
    .sendMessage({ type: 'ATTACH_APP_AUDIO_VALIDATED', validation: payload })
    .catch(() => undefined);
}

async function openChromeCaptureByDeviceId(
  device: ChromeAudioInputInfo
): Promise<MediaStream | null> {
  const devices = await navigator.mediaDevices.enumerateDevices();
  logChromeAudioInputsTable(devices);
  console.log('[offscreen] selected deviceId:', device.deviceId);
  console.log('[offscreen] selected label:', device.label || '(empty)');

  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: { ...AUDIO_CAPTURE_OPTS, deviceId: { exact: device.deviceId } },
    });
  } catch (err: unknown) {
    const name = err instanceof DOMException ? err.name : String(err);
    console.warn('[offscreen] getUserMedia failed for', device.deviceId, name);
    return null;
  }
}

/**
 * Locate and open the virtual capture device by baseline diff.
 * Chrome labels remap mics (e.g. "Application") — not Pulse source names.
 */
async function openVirtualCaptureStream(_target: VirtualCaptureTarget): Promise<MediaStream | null> {
  const MAX_ATTEMPTS = 20;
  const DELAY_MS = 400;

  console.log('[offscreen] openVirtualCaptureStream — baseline diff device selection');

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      await waitForDeviceChange(DELAY_MS);
    }

    const devices = await navigator.mediaDevices.enumerateDevices();
    const audioInputs = devices.filter((d) => d.kind === 'audioinput');
    if (attempt === 0 || attempt % 5 === 0) {
      console.log(
        `[offscreen] enumerateDevices attempt ${attempt + 1}, count: ${audioInputs.length}`,
        formatAudioInputsForLog(devices)
      );
    }

    const selected = selectChromeCaptureDevice(devices, baselineAudioDeviceIds);
    if (!selected) {
      const novel = findNovelChromeCaptureInputs(devices, baselineAudioDeviceIds);
      if (attempt < MAX_ATTEMPTS - 1) {
        console.log(
          `[offscreen] no novel audioinput yet (${attempt + 1}/${MAX_ATTEMPTS}), novel count: ${novel.length}`
        );
      }
      continue;
    }

    const stream = await openChromeCaptureByDeviceId(selected);
    const track = stream?.getAudioTracks()[0];
    if (stream && track && verifyOpenedCaptureTrack(track, baselineAudioDeviceIds)) {
      console.log('[offscreen] getUserMedia succeeded — capture track ready');
      return stream;
    }
    stream?.getTracks().forEach((t) => t.stop());
  }

  return null;
}

function isNativeMirrorSurface(surface: string | undefined): boolean {
  return surface === 'window' || surface === 'monitor';
}

async function attachAppAudio(target: VirtualCaptureTarget): Promise<boolean> {
  try {
    await primeOffscreenAudioPermission();

    const stream = await openVirtualCaptureStream(target);
    if (stream) {
      appAudioStream?.getTracks().forEach((t) => t.stop());
      appAudioStream = stream;
      const track = stream.getAudioTracks()[0];
      if (track) await logAttachValidation(track, target);
      chrome.runtime.sendMessage({ type: 'ATTACH_APP_AUDIO_SUCCEEDED' }).catch(() => undefined);
      return true;
    }

    reportAudioDeviceInventory(target);

    const warning =
      'No novel Chrome audioinput appeared after virtual device creation. ' +
      'Check offscreen logs for enumerateDevices table and baseline diff.';
    console.warn('[offscreen] attachAppAudio failed:', warning);
    chrome.runtime.sendMessage({ type: 'ATTACH_APP_AUDIO_FAILED', warning }).catch(() => undefined);
    chrome.runtime.sendMessage({ type: 'RECORDING_WARNING', warning }).catch(() => undefined);
    return false;
  } catch (err: unknown) {
    const warning = `Mirror audio unavailable: ${err instanceof Error ? err.message : String(err)}`;
    console.warn('[offscreen] attachAppAudio error:', err);
    chrome.runtime.sendMessage({ type: 'ATTACH_APP_AUDIO_FAILED', warning }).catch(() => undefined);
    chrome.runtime.sendMessage({ type: 'RECORDING_WARNING', warning }).catch(() => undefined);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Main capture flow
// ---------------------------------------------------------------------------

async function startCapture(message: {
  includeMic: boolean;
  focusMode?: boolean;
  audioSettings?: AudioMixSettings;
  initialStreamId?: string;
  sessionId?: string;
  isContinuation?: boolean;
  initialDuration?: number;
  hasConfirmedDurationExtension?: boolean;
  os?: string;
}): Promise<void> {
  const audioSettings = message.audioSettings ?? DEFAULT_AUDIO_SETTINGS;
  const isLinux = message.os === 'linux' || /linux/i.test(navigator.userAgent);
  let mixResult: ReturnType<typeof mixAudioStreams> = null;
  let currentStep = 'initializing';

  try {
    if (message.includeMic) {
      currentStep = 'priming_mic_permission';
      await primeOffscreenAudioPermission();
    }
    currentStep = 'snapshotting_baseline_audio_devices';
    await snapshotBaselineAudioDevices();

    if (message.initialStreamId) {
      currentStep = 'capturing_tab_stream';
      console.log('[offscreen] capturing tab stream (Focus 1-1)…');
      screenStream = await captureTabStream(message.initialStreamId, true);
    } else if (message.focusMode) {
      throw new Error('Tab capture failed. Switch to a recordable tab and try again.');
    } else {
      currentStep = 'opening_screen_picker';
      console.log('[offscreen] opening screen picker (getDisplayMedia)…');
      screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true,
      });

      // Detect displaySurface and notify background so it can prepare app audio.
      // Hoist surface to outer scope so we can wait for app audio below.
      const firstTrack = screenStream.getVideoTracks()[0];
      if (firstTrack) {
        currentStep = 'detecting_display_surface';
        detectedSurface = (firstTrack.getSettings() as any).displaySurface as string | undefined;
        const sourceLabel = firstTrack.label?.trim() || undefined;
        chrome.runtime
          .sendMessage({
            type: 'DISPLAY_SURFACE_DETECTED',
            surface: detectedSurface ?? 'unknown',
            sourceLabel,
          })
          .catch(() => undefined);
        console.log('[offscreen] displaySurface:', detectedSurface, 'label:', sourceLabel);

        // Native mirror path uses the virtual sink — discard display-media audio
        // so we never accidentally record Chrome's loopback instead of pw-link mirror.
        if (isNativeMirrorSurface(detectedSurface) && isLinux) {
          for (const t of screenStream.getAudioTracks()) {
            console.log('[offscreen] dropping display-media audio track (using mirror sink)');
            t.stop();
          }
        }
      }
    }
    console.log('[offscreen] screen stream acquired');

    // Wait for native virtual device BEFORE starting recorder (mirror sink only).
    if (isNativeMirrorSurface(detectedSurface) && isLinux) {
      currentStep = 'waiting_mirror_sink';
      console.log('[offscreen] waiting for mirror sink attach before recorder…');
      const attached = await waitForAppAudioStream(25_000);
      if (attached) {
        console.log('[offscreen] mirror sink attached — will record from native virtual device');
      } else {
        console.warn('[offscreen] mirror sink not attached — recording video only');
        chrome.runtime.sendMessage({
          type: 'RECORDING_WARNING',
          warning:
            'Mirrored application audio not available. Video will record without app/screen audio.',
        }).catch(() => undefined);
      }
    }

    if (message.includeMic) {
      currentStep = 'acquiring_mic_stream';
      try {
        micStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          }
        });
      } catch (err: any) {
        console.warn('[offscreen] microphone access denied:', err);
        chrome.runtime.sendMessage({
          type: 'RECORDING_WARNING',
          warning: 'Microphone could not be accessed. Recording without microphone.',
        });
      }
    }

    const videoTrack = screenStream.getVideoTracks()[0];
    if (!videoTrack) throw new Error('No video track found in screen capture stream');

    // Video track ended (Stop sharing)
    videoTrack.onended = () => {
      console.log('[offscreen] Video track ended (Screen sharing stopped) — finalizng recording.');
      void stopCapture();
    };

    currentStep = 'initializing_canvas_router';
    canvasRouter = new CanvasRouter({ width: 1920, height: 1080, fps: 30 });
    canvasRouter.setActiveSource(new MediaStream([videoTrack]));
    currentStep = 'waiting_canvas_first_frame';
    await canvasRouter.waitForFrame();
    console.log('[offscreen] canvas ready, starting recorder…');

    const finalStream = new MediaStream([...canvasRouter.getOutputStream().getVideoTracks()]);
    const additionalTracksToCleanup: MediaStreamTrack[] = [];

    streamMonitor = new StreamHealthMonitor((event, trackId) => {
      chrome.runtime.sendMessage({ type: 'STREAM_HEALTH_EVENT', event, trackId }).catch(() => undefined);
      if (event === 'VIDEO_SOURCE_LOST' || event === 'VIDEO_FROZEN') {
        canvasRouter?.switchToPlaceholder('Video Source Lost');
      }
    });

    audioMonitor = new AudioHealthMonitor((event, trackId) => {
      chrome.runtime.sendMessage({ type: 'AUDIO_HEALTH_EVENT', event, trackId }).catch(() => undefined);
    });

    streamMonitor.setVideoTrack(videoTrack);

    // For window/monitor: ONLY the mirror sink stream — never display-media or default mic.
    const useMirrorSink = isNativeMirrorSurface(detectedSurface) && isLinux;
    const systemAudioTrack = useMirrorSink
      ? appAudioStream?.getAudioTracks()[0]
      : appAudioStream?.getAudioTracks()[0] ?? screenStream.getAudioTracks()[0];
    const micAudioTrack = micStream?.getAudioTracks()[0];

    // Focus mode captures tab audio via getUserMedia(chromeMediaSource:'tab'),
    // which MUTES the tab's own playback at the source — always monitor it.
    const shouldMonitorSystem = message.focusMode ? true : audioSettings.routeSystemToSpeakers;

    if (systemAudioTrack) {
      streamMonitor?.addAudioTrack(systemAudioTrack);
      audioMonitor?.addTrack(systemAudioTrack);

      systemAudioTrack.onended = () => {
        console.warn('[offscreen] System audio track ended.');
        chrome.runtime.sendMessage({
          type: 'RECORDING_WARNING',
          warning: 'System audio capture ended. Recording continues without system audio.',
        }).catch(() => undefined);
      };
    }
    if (micAudioTrack) {
      streamMonitor?.addAudioTrack(micAudioTrack);
      audioMonitor?.addTrack(micAudioTrack);

      micAudioTrack.onended = () => {
        console.warn('[offscreen] Microphone track ended.');
        chrome.runtime.sendMessage({
          type: 'RECORDING_WARNING',
          warning: 'Microphone track ended. Attempting to re-acquire...',
        }).catch(() => undefined);
      };
      micAudioTrack.onmute = () => {
        console.warn('[offscreen] Microphone track muted.');
        chrome.runtime.sendMessage({
          type: 'AUDIO_HEALTH_EVENT',
          event: 'AUDIO_SILENT',
          trackId: micAudioTrack.id
        }).catch(() => undefined);
      };
      micAudioTrack.onunmute = () => {
        console.log('[offscreen] Microphone track unmuted.');
        chrome.runtime.sendMessage({
          type: 'AUDIO_HEALTH_EVENT',
          event: 'AUDIO_ACTIVE',
          trackId: micAudioTrack.id
        }).catch(() => undefined);
      };
    }

    if (systemAudioTrack || micAudioTrack) {
      currentStep = 'mixing_audio_streams';
      mixResult = mixAudioStreams(
        systemAudioTrack ? new MediaStream([systemAudioTrack]) : null,
        micStream,
        {
          ...audioSettings,
          routeSystemToSpeakers: shouldMonitorSystem,
        }
      );
      if (mixResult?.mixedTrack) {
        finalStream.addTrack(mixResult.mixedTrack);
        mixAudioContext = mixResult.audioContext;
        micSourceNode = mixResult.micSourceNode ?? null;
        micGainNode = mixResult.micGainNode ?? null;
        systemSourceNode = mixResult.systemSourceNode ?? null;
        systemGainNode = mixResult.systemGainNode ?? null;
        compressorNode = mixResult.compressorNode ?? null;
        dummyOscillatorNode = mixResult.dummyOscillatorNode ?? null;
        dummyGainNode = mixResult.dummyGainNode ?? null;

        // Auto-resume safeguard
        mixAudioContext.onstatechange = () => {
          if (mixAudioContext && mixAudioContext.state === 'suspended' && recorder && recorder.getState() === 'recording') {
            console.log('[offscreen] AudioContext suspended unexpectedly, resuming...');
            mixAudioContext.resume().catch(console.error);
          }
        };
      }
      if (systemAudioTrack) additionalTracksToCleanup.push(systemAudioTrack);
      if (micStream) additionalTracksToCleanup.push(...micStream.getTracks());
    } else if (micStream) {
      additionalTracksToCleanup.push(...micStream.getTracks());
    }

    currentStep = 'starting_media_recorder';
    await recorder?.start(
      finalStream,
      additionalTracksToCleanup,
      mixResult?.audioContext ?? null,
      message.sessionId,
      message.isContinuation ?? false,
      message.initialDuration ?? 0,
      message.hasConfirmedDurationExtension ?? false
    );
    const hasAudio = finalStream.getAudioTracks().length > 0;
    console.log(
      '[offscreen] recorder started → CAPTURE_STARTED',
      hasAudio ? '(with mirror/mic audio)' : '(video only)'
    );
    chrome.runtime.sendMessage({ type: 'CAPTURE_STARTED' });

  } catch (err: any) {
    const isCancellation =
      err.name === 'NotAllowedError' ||
      err.name === 'AbortError' ||
      err.message?.includes('Permission denied');
    const isNotFound =
      err.name === 'NotFoundError' || err.message?.toLowerCase().includes('not found');

    const captureMode = message.initialStreamId ? 'tab-capture' : (message.focusMode ? 'focus-mode' : 'screen-picker');
    console.error(`[offscreen] startCapture error at step [${currentStep}] (mode: ${captureMode}):`, {
      name: err?.name,
      message: err?.message,
      stack: err?.stack,
    });

    let errorMessage = err.message || 'Failed to start screen capture';
    if (isCancellation) {
      chrome.runtime.sendMessage({ type: 'CAPTURE_CANCELLED' });
    } else {
      if (isNotFound && message.focusMode)
        errorMessage =
          'Tab capture failed (device not found). Stay on the selected tab and try again.';

      chrome.runtime.sendMessage({ type: 'RECORDING_ERROR', error: errorMessage });
    }
    cleanupPartialCapture(mixResult?.audioContext ?? null);
  }
}

async function fallbackToDisplayMedia(): Promise<void> {
  try {
    console.log('[offscreen] fallback to display media…');
    const newStream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: true,
    });

    const videoTrack = newStream.getVideoTracks()[0];
    if (!videoTrack) throw new Error('No video track found in fallback stream');

    detectedSurface = (videoTrack.getSettings() as any).displaySurface as string | undefined;
    const sourceLabel = videoTrack.label?.trim() || undefined;
    console.log('[offscreen] fallback displaySurface:', detectedSurface, 'label:', sourceLabel);

    chrome.runtime
      .sendMessage({
        type: 'DISPLAY_SURFACE_DETECTED',
        surface: detectedSurface ?? 'unknown',
        sourceLabel,
      })
      .catch(() => undefined);

    if (isNativeMirrorSurface(detectedSurface)) {
      for (const t of newStream.getAudioTracks()) {
        console.log('[offscreen] dropping fallback display-media audio track (using mirror sink)');
        t.stop();
      }
    }

    canvasRouter?.setActiveSource(newStream);
    streamMonitor?.setVideoTrack(videoTrack);

    chrome.runtime.sendMessage({ type: 'SOURCE_FALLBACK_SUCCESS' }).catch(() => undefined);
  } catch (err: any) {
    console.error('[offscreen] fallback to display media failed:', err);
    chrome.runtime.sendMessage({
      type: 'RECORDING_WARNING',
      warning: `Failed to fallback: ${err.message || 'permission denied'}`
    }).catch(() => undefined);
  }
}

async function switchSource(streamId: string): Promise<void> {
  if (!canvasRouter || !streamId) return;
  try {
    const newStream = await captureTabStream(streamId, false);
    canvasRouter.setActiveSource(newStream);
  } catch (err: any) {
    console.warn('[offscreen] failed to switch canvas source:', err);
    chrome.runtime.sendMessage({
      type: 'RECORDING_WARNING',
      warning: `Could not switch tab: ${err.message || 'capture failed'}`,
    });
  }
}

async function stopCapture(reason?: string): Promise<void> {
  if (recorder) await recorder.stop(reason);
  cleanupCaptureResources();
}

async function handleDeviceChange(): Promise<void> {
  if (!recorder || recorder.getState() === 'inactive' || !micStream || !mixAudioContext) {
    return;
  }

  const micTrack = micStream.getAudioTracks()[0];
  if (!micTrack || micTrack.readyState === 'ended') {
    console.log('[offscreen] Microphone device disconnected, attempting to re-acquire default mic stream...');
    chrome.runtime.sendMessage({
      type: 'RECORDING_WARNING',
      warning: 'Microphone disconnected! Attempting to re-acquire audio device...'
    }).catch(() => undefined);

    micStream.getTracks().forEach((t) => {
      t.onended = null;
      t.onmute = null;
      t.onunmute = null;
      t.stop();
    });

    try {
      const newMicStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        }
      });
      const newMicTrack = newMicStream.getAudioTracks()[0];

      if (newMicTrack && mixAudioContext && mixAudioContext.state !== 'closed') {
        console.log('[offscreen] Microphone re-acquired successfully. Re-attaching to mixer...');

        micStream = newMicStream;

        // Gán lại các event handlers cho mic track mới
        newMicTrack.onended = () => {
          console.warn('[offscreen] Re-acquired microphone track ended.');
          chrome.runtime.sendMessage({
            type: 'RECORDING_WARNING',
            warning: 'Microphone track ended. Attempting to re-acquire...',
          }).catch(() => undefined);
        };
        newMicTrack.onmute = () => {
          console.warn('[offscreen] Re-acquired microphone track muted.');
          chrome.runtime.sendMessage({
            type: 'AUDIO_HEALTH_EVENT',
            event: 'AUDIO_SILENT',
            trackId: newMicTrack.id
          }).catch(() => undefined);
        };
        newMicTrack.onunmute = () => {
          console.log('[offscreen] Re-acquired microphone track unmuted.');
          chrome.runtime.sendMessage({
            type: 'AUDIO_HEALTH_EVENT',
            event: 'AUDIO_ACTIVE',
            trackId: newMicTrack.id
          }).catch(() => undefined);
        };

        if (micGainNode) {
          // Fade-out mượt mà gain hiện tại về 0 trước khi cắm nguồn mới
          const now = mixAudioContext.currentTime;
          const targetGain = micGainNode.gain.value;
          micGainNode.gain.setValueAtTime(targetGain, now);
          micGainNode.gain.linearRampToValueAtTime(0, now + 0.05); // 50ms fade out

          setTimeout(() => {
            try {
              micSourceNode?.disconnect();
            } catch (e) {
              console.warn('[offscreen] failed to disconnect old micSourceNode:', e);
            }

            if (mixAudioContext && mixAudioContext.state !== 'closed') {
              micSourceNode = mixAudioContext.createMediaStreamSource(newMicStream);
              if (micGainNode) {
                micSourceNode.connect(micGainNode);
                const now2 = mixAudioContext.currentTime;
                micGainNode.gain.setValueAtTime(0, now2);
                micGainNode.gain.linearRampToValueAtTime(targetGain, now2 + 0.1); // 100ms fade in
              }
            }
          }, 60);
        } else {
          try {
            micSourceNode?.disconnect();
          } catch (e) { }
          micSourceNode = mixAudioContext.createMediaStreamSource(newMicStream);
        }

        streamMonitor?.addAudioTrack(newMicTrack);
        audioMonitor?.addTrack(newMicTrack);

        chrome.runtime.sendMessage({
          type: 'AUDIO_HEALTH_EVENT',
          event: 'AUDIO_ACTIVE',
          trackId: newMicTrack.id
        }).catch(() => undefined);
      } else {
        throw new Error('No audio track in re-acquired mic stream');
      }
    } catch (err: any) {
      console.error('[offscreen] failed to re-acquire microphone:', err);
      chrome.runtime.sendMessage({
        type: 'AUDIO_HEALTH_EVENT',
        event: 'AUDIO_SOURCE_LOST'
      }).catch(() => undefined);
      chrome.runtime.sendMessage({
        type: 'RECORDING_WARNING',
        warning: 'Failed to re-acquire microphone. Recording audio is unavailable.'
      }).catch(() => undefined);
    }
  }
}

function cleanupPartialCapture(audioContext: AudioContext | null): void {
  // Hủy bỏ handlers của tracks để chống memory leaks và stop các tracks
  screenStream?.getTracks().forEach((t) => {
    t.onended = null;
    t.stop();
  });
  micStream?.getTracks().forEach((t) => {
    t.onended = null;
    t.onmute = null;
    t.onunmute = null;
    t.stop();
  });
  appAudioStream?.getTracks().forEach((t) => {
    t.onended = null;
    t.stop();
  });

  screenStream = null;
  micStream = null;
  appAudioStream = null;
  detectedSurface = undefined;
  baselineAudioDeviceIds = new Set();

  streamMonitor?.destroy();
  streamMonitor = null;
  audioMonitor?.destroy();
  audioMonitor = null;

  // Ngắt kết nối tường minh Web Audio Graph
  try {
    micSourceNode?.disconnect();
  } catch (e) { }
  try {
    systemSourceNode?.disconnect();
  } catch (e) { }
  try {
    micGainNode?.disconnect();
  } catch (e) { }
  try {
    systemGainNode?.disconnect();
  } catch (e) { }
  try {
    compressorNode?.disconnect();
  } catch (e) { }
  try {
    dummyOscillatorNode?.stop();
    dummyOscillatorNode?.disconnect();
  } catch (e) { }
  try {
    dummyGainNode?.disconnect();
  } catch (e) { }

  micSourceNode = null;
  micGainNode = null;
  systemSourceNode = null;
  systemGainNode = null;
  compressorNode = null;
  dummyOscillatorNode = null;
  dummyGainNode = null;

  canvasRouter?.destroy();
  canvasRouter = null;

  if (audioContext && audioContext.state !== 'closed') {
    audioContext.close().catch(console.error);
  }
  mixAudioContext = null;
}

function cleanupCaptureResources(): void {
  // Hủy bỏ handlers của tracks để chống memory leaks và stop các tracks
  screenStream?.getTracks().forEach((t) => {
    t.onended = null;
    if (t.readyState !== 'ended') t.stop();
  });
  micStream?.getTracks().forEach((t) => {
    t.onended = null;
    t.onmute = null;
    t.onunmute = null;
    t.stop();
  });
  appAudioStream?.getTracks().forEach((t) => {
    t.onended = null;
    t.stop();
  });

  screenStream = null;
  micStream = null;
  appAudioStream = null;
  detectedSurface = undefined;
  baselineAudioDeviceIds = new Set();

  streamMonitor?.destroy();
  streamMonitor = null;
  audioMonitor?.destroy();
  audioMonitor = null;

  // Ngắt kết nối tường minh Web Audio Graph
  try {
    micSourceNode?.disconnect();
  } catch (e) { }
  try {
    systemSourceNode?.disconnect();
  } catch (e) { }
  try {
    micGainNode?.disconnect();
  } catch (e) { }
  try {
    systemGainNode?.disconnect();
  } catch (e) { }
  try {
    compressorNode?.disconnect();
  } catch (e) { }
  try {
    dummyOscillatorNode?.stop();
    dummyOscillatorNode?.disconnect();
  } catch (e) { }
  try {
    dummyGainNode?.disconnect();
  } catch (e) { }

  micSourceNode = null;
  micGainNode = null;
  systemSourceNode = null;
  systemGainNode = null;
  compressorNode = null;
  dummyOscillatorNode = null;
  dummyGainNode = null;

  canvasRouter?.destroy();
  canvasRouter = null;

  if (mixAudioContext && mixAudioContext.state !== 'closed') {
    mixAudioContext.close().catch(console.error);
  }
  mixAudioContext = null;
}
