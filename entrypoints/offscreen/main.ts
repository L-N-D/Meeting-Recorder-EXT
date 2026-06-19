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

chrome.runtime.sendMessage({ type: 'OFFSCREEN_READY' }).catch(() => undefined);

recorder = new ScreenRecorder({
  onBlobReady: (blob) => {
    if (currentBlobUrl) URL.revokeObjectURL(currentBlobUrl);
    currentBlobUrl = URL.createObjectURL(blob);
    chrome.runtime.sendMessage({
      type: 'RECORDING_COMPLETE',
      url: currentBlobUrl,
      mimeType: blob.type,
    });
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
      void stopCapture().then(() => sendResponse({ success: true }));
      return true;
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
    if (name !== 'NotFoundError' && name !== 'NotAllowedError') {
      console.warn('[offscreen] audio permission primer:', name);
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
}): Promise<void> {
  const audioSettings = message.audioSettings ?? DEFAULT_AUDIO_SETTINGS;
  let mixResult: ReturnType<typeof mixAudioStreams> = null;

  try {
    await primeOffscreenAudioPermission();
    await snapshotBaselineAudioDevices();

    if (message.initialStreamId) {
      console.log('[offscreen] capturing tab stream (Focus 1-1)…');
      screenStream = await captureTabStream(message.initialStreamId, true);
    } else if (message.focusMode) {
      throw new Error('Tab capture failed. Switch to a recordable tab and try again.');
    } else {
      console.log('[offscreen] opening screen picker (getDisplayMedia)…');
      screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true,
      });

      // Detect displaySurface and notify background so it can prepare app audio.
      // Hoist surface to outer scope so we can wait for app audio below.
      const firstTrack = screenStream.getVideoTracks()[0];
      if (firstTrack) {
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
        if (isNativeMirrorSurface(detectedSurface)) {
          for (const t of screenStream.getAudioTracks()) {
            console.log('[offscreen] dropping display-media audio track (using mirror sink)');
            t.stop();
          }
        }
      }
    }
    console.log('[offscreen] screen stream acquired');

    // Wait for native virtual device BEFORE starting recorder (mirror sink only).
    if (isNativeMirrorSurface(detectedSurface)) {
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
      try {
        micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
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

    canvasRouter = new CanvasRouter({ width: 1920, height: 1080, fps: 30 });
    canvasRouter.setActiveSource(new MediaStream([videoTrack]));
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
    const useMirrorSink = isNativeMirrorSurface(detectedSurface);
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
    }
    if (micAudioTrack) {
      streamMonitor?.addAudioTrack(micAudioTrack);
      audioMonitor?.addTrack(micAudioTrack);
    }

    if (systemAudioTrack || micAudioTrack) {
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
      }
      if (systemAudioTrack) additionalTracksToCleanup.push(systemAudioTrack);
      if (micStream) additionalTracksToCleanup.push(...micStream.getTracks());
    } else if (micStream) {
      additionalTracksToCleanup.push(...micStream.getTracks());
    }

    await recorder?.start(
      finalStream,
      additionalTracksToCleanup,
      mixResult?.audioContext ?? null,
      message.sessionId,
      message.isContinuation ?? false,
      message.initialDuration ?? 0
    );
    const hasAudio = finalStream.getAudioTracks().length > 0;
    console.log(
      '[offscreen] recorder started → CAPTURE_STARTED',
      hasAudio ? '(with mirror/mic audio)' : '(video only)'
    );
    chrome.runtime.sendMessage({ type: 'CAPTURE_STARTED' });

  } catch (err: any) {
    console.error('[offscreen] startCapture error:', err);
    const isCancellation =
      err.name === 'NotAllowedError' || err.message?.includes('Permission denied');
    const isNotFound =
      err.name === 'NotFoundError' || err.message?.toLowerCase().includes('not found');

    let errorMessage = err.message || 'Failed to start screen capture';
    if (isCancellation) errorMessage = 'Recording cancelled';
    else if (isNotFound && message.focusMode)
      errorMessage =
        'Tab capture failed (device not found). Stay on the selected tab and try again.';

    chrome.runtime.sendMessage({ type: 'RECORDING_ERROR', error: errorMessage });
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

async function stopCapture(): Promise<void> {
  if (recorder) await recorder.stop();
  cleanupCaptureResources();
}

function cleanupPartialCapture(audioContext: AudioContext | null): void {
  screenStream?.getTracks().forEach((t) => t.stop());
  micStream?.getTracks().forEach((t) => t.stop());
  appAudioStream?.getTracks().forEach((t) => t.stop());
  screenStream = null;
  micStream = null;
  appAudioStream = null;
  detectedSurface = undefined;
  baselineAudioDeviceIds = new Set();
  
  streamMonitor?.destroy();
  streamMonitor = null;
  audioMonitor?.destroy();
  audioMonitor = null;

  canvasRouter?.destroy();
  canvasRouter = null;
  audioContext?.close().catch(console.error);
  mixAudioContext = null;
}

function cleanupCaptureResources(): void {
  screenStream?.getTracks().forEach((t) => {
    if (t.readyState !== 'ended') t.stop();
  });
  micStream?.getTracks().forEach((t) => t.stop());
  appAudioStream?.getTracks().forEach((t) => t.stop());
  screenStream = null;
  micStream = null;
  appAudioStream = null;
  detectedSurface = undefined;
  baselineAudioDeviceIds = new Set();
  
  streamMonitor?.destroy();
  streamMonitor = null;
  audioMonitor?.destroy();
  audioMonitor = null;

  canvasRouter?.destroy();
  canvasRouter = null;
  mixAudioContext?.close().catch(console.error);
  mixAudioContext = null;
}
