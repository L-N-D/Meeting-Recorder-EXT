import { mixAudioStreams } from '../../utils/audioMixer';
import { CanvasRouter } from '../../utils/canvasRouter';
import { ScreenRecorder } from '../../utils/recording';
import { DEFAULT_AUDIO_SETTINGS, type AudioMixSettings } from '../../utils/types';

let recorder: ScreenRecorder | null = null;
let canvasRouter: CanvasRouter | null = null;
let currentBlobUrl: string | null = null;
let screenStream: MediaStream | null = null;
let micStream: MediaStream | null = null;
let mixAudioContext: AudioContext | null = null;

chrome.runtime.sendMessage({ type: 'OFFSCREEN_READY' }).catch(() => undefined);

recorder = new ScreenRecorder({
  onBlobReady: (blob) => {
    if (currentBlobUrl) {
      URL.revokeObjectURL(currentBlobUrl);
    }
    currentBlobUrl = URL.createObjectURL(blob);

    chrome.runtime.sendMessage({
      type: 'RECORDING_COMPLETE',
      url: currentBlobUrl,
      mimeType: blob.type,
    });
  },
  onTimeUpdate: (seconds) => {
    chrome.runtime.sendMessage({
      type: 'RECORDING_TICK',
      duration: seconds,
    });
  },
  onError: (error) => {
    console.error('Offscreen recording error:', error);
    chrome.runtime.sendMessage({
      type: 'RECORDING_ERROR',
      error: error.message,
    });
  },
  onStateChange: (state) => {
    chrome.runtime.sendMessage({
      type: state === 'paused' ? 'RECORDING_PAUSED' : 'RECORDING_RESUMED',
    });
  },
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  switch (message.type) {
    case 'START_RECORDING':
      void startCapture(message);
      sendResponse({ success: true });
      break;
    case 'STOP_RECORDING':
      stopCapture();
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
  }
  return true;
});

async function startCapture(message: {
  includeMic: boolean;
  focusMode?: boolean;
  audioSettings?: AudioMixSettings;
}): Promise<void> {
  const audioSettings = message.audioSettings ?? DEFAULT_AUDIO_SETTINGS;
  let mixResult: ReturnType<typeof mixAudioStreams> = null;

  try {
    screenStream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: true,
    });

    if (message.includeMic) {
      try {
        micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (err: any) {
        console.warn('Microphone access denied or unavailable:', err);
        chrome.runtime.sendMessage({
          type: 'RECORDING_WARNING',
          warning: 'Microphone could not be accessed. Recording without microphone.',
        });
      }
    }

    const videoTrack = screenStream.getVideoTracks()[0];
    if (!videoTrack) {
      throw new Error('No video track found in screen capture stream');
    }

    canvasRouter = new CanvasRouter({ width: 1920, height: 1080, fps: 30 });
    canvasRouter.setActiveSource(new MediaStream([videoTrack]));

    const finalStream = new MediaStream([...canvasRouter.getOutputStream().getVideoTracks()]);
    const additionalTracksToCleanup: MediaStreamTrack[] = [];

    const systemAudioTrack = screenStream.getAudioTracks()[0];
    const micAudioTrack = micStream?.getAudioTracks()[0];

    if (systemAudioTrack && micAudioTrack) {
      mixResult = mixAudioStreams(screenStream, micStream, audioSettings);
      if (mixResult?.mixedTrack) {
        finalStream.addTrack(mixResult.mixedTrack);
        mixAudioContext = mixResult.audioContext;
      }

      additionalTracksToCleanup.push(systemAudioTrack, micAudioTrack);
      micStream?.getTracks().forEach((track) => {
        if (track !== micAudioTrack) {
          additionalTracksToCleanup.push(track);
        }
      });
    } else if (systemAudioTrack) {
      finalStream.addTrack(systemAudioTrack);
      if (micStream) {
        additionalTracksToCleanup.push(...micStream.getTracks());
      }
    } else if (micAudioTrack) {
      finalStream.addTrack(micAudioTrack);
      micStream?.getTracks().forEach((track) => {
        if (track !== micAudioTrack) {
          additionalTracksToCleanup.push(track);
        }
      });
    } else if (micStream) {
      additionalTracksToCleanup.push(...micStream.getTracks());
    }

    await recorder?.start(finalStream, additionalTracksToCleanup, mixResult?.audioContext ?? null);

    chrome.runtime.sendMessage({ type: 'CAPTURE_STARTED' });

    videoTrack.onended = () => {
      console.log('Video track ended (user stopped sharing)');
      stopCapture();
    };
  } catch (err: any) {
    console.error('Error starting capture in offscreen:', err);

    const isCancellation =
      err.name === 'NotAllowedError' || err.message?.includes('Permission denied');
    chrome.runtime.sendMessage({
      type: 'RECORDING_ERROR',
      error: isCancellation ? 'Recording cancelled' : err.message || 'Failed to start screen capture',
    });

    cleanupPartialCapture(mixResult?.audioContext ?? null);
  }
}

async function switchSource(streamId: string): Promise<void> {
  if (!canvasRouter || !streamId) {
    return;
  }

  try {
    const newStream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        mandatory: {
          chromeMediaSource: 'tab',
          chromeMediaSourceId: streamId,
        },
      },
    } as MediaStreamConstraints);

    canvasRouter.setActiveSource(newStream);
  } catch (err) {
    console.warn('Failed to switch canvas source:', err);
  }
}

function stopCapture(): void {
  recorder?.stop();
  cleanupCaptureResources();
}

function cleanupPartialCapture(audioContext: AudioContext | null): void {
  screenStream?.getTracks().forEach((track) => track.stop());
  micStream?.getTracks().forEach((track) => track.stop());
  screenStream = null;
  micStream = null;

  canvasRouter?.destroy();
  canvasRouter = null;

  audioContext?.close().catch(console.error);
  mixAudioContext = null;
}

function cleanupCaptureResources(): void {
  screenStream?.getTracks().forEach((track) => {
    if (track.readyState !== 'ended') {
      track.stop();
    }
  });
  micStream?.getTracks().forEach((track) => track.stop());
  screenStream = null;
  micStream = null;

  canvasRouter?.destroy();
  canvasRouter = null;

  mixAudioContext?.close().catch(console.error);
  mixAudioContext = null;
}
