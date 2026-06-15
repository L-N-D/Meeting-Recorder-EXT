import { mixAudioStreams } from '../../utils/audioMixer';
import { ScreenRecorder } from '../../utils/recording';

let recorder: ScreenRecorder | null = null;
let currentBlobUrl: string | null = null;

// Initialize the recorder
recorder = new ScreenRecorder({
  onBlobReady: (blob) => {
    // Revoke previous URL to prevent memory leaks
    if (currentBlobUrl) {
      URL.revokeObjectURL(currentBlobUrl);
    }
    currentBlobUrl = URL.createObjectURL(blob);
    
    // Notify background script to trigger download
    chrome.runtime.sendMessage({
      type: 'RECORDING_COMPLETE',
      url: currentBlobUrl,
      mimeType: blob.type
    });
  },
  onTimeUpdate: (seconds) => {
    chrome.runtime.sendMessage({
      type: 'RECORDING_TICK',
      duration: seconds
    });
  },
  onError: (error) => {
    console.error('Offscreen recording error:', error);
    chrome.runtime.sendMessage({
      type: 'RECORDING_ERROR',
      error: error.message
    });
  }
});

// Listen to control commands from background service worker
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'START_RECORDING') {
    startCapture(message);
    sendResponse({ success: true });
  } else if (message.type === 'STOP_RECORDING') {
    stopCapture();
    sendResponse({ success: true });
  }
  return true;
});

/**
 * Capture screen and optional mic, mix audio, and start recording.
 */
async function startCapture(message: {
  includeMic: boolean;
}) {
  let screenStream: MediaStream | null = null;
  let micStream: MediaStream | null = null;
  let mixResult: ReturnType<typeof mixAudioStreams> = null;

  try {
    // 1. Get the screen capture stream directly (this will display Chrome's native picker)
    screenStream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: true
    });

    // 2. Get the microphone stream if requested
    if (message.includeMic) {
      try {
        micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (err: any) {
        console.warn('Microphone access denied or unavailable:', err);
        chrome.runtime.sendMessage({
          type: 'RECORDING_WARNING',
          warning: 'Microphone could not be accessed. Recording without microphone.'
        });
      }
    }

    // 3. Perform audio mixing
    mixResult = mixAudioStreams(screenStream, micStream);

    // 4. Construct final stream for MediaRecorder
    const videoTrack = screenStream.getVideoTracks()[0];
    if (!videoTrack) {
      throw new Error('No video track found in screen capture stream');
    }

    const finalStream = new MediaStream([videoTrack]);
    
    if (mixResult && mixResult.mixedTrack) {
      finalStream.addTrack(mixResult.mixedTrack);
    }

    // Keep tracks and context for cleanup, excluding finalStream tracks which are stopped by recorder
    const additionalTracksToCleanup: MediaStreamTrack[] = [];
    if (micStream) {
      additionalTracksToCleanup.push(...micStream.getTracks());
    }
    if (screenStream) {
      const systemAudioTrack = screenStream.getAudioTracks()[0];
      if (systemAudioTrack) {
        additionalTracksToCleanup.push(systemAudioTrack);
      }
    }

    // 5. Start MediaRecorder
    recorder?.start(
      finalStream,
      additionalTracksToCleanup,
      mixResult?.audioContext || null
    );

    // Watch for screen sharing being stopped by the user via Chrome native floating bar
    videoTrack.onended = () => {
      console.log('Video track ended (user stopped sharing)');
      stopCapture();
    };

  } catch (err: any) {
    console.error('Error starting capture in offscreen:', err);
    
    const isCancellation = err.name === 'NotAllowedError' || err.message?.includes('Permission denied');
    chrome.runtime.sendMessage({
      type: 'RECORDING_ERROR',
      error: isCancellation ? 'Recording cancelled' : (err.message || 'Failed to start screen capture')
    });

    // Cleanup any partially opened streams
    if (screenStream) {
      screenStream.getTracks().forEach(t => t.stop());
    }
    if (micStream) {
      micStream.getTracks().forEach(t => t.stop());
    }
    if (mixResult && mixResult.audioContext) {
      mixResult.audioContext.close().catch(console.error);
    }
  }
}

/**
 * Stops the capture.
 */
function stopCapture() {
  if (recorder) {
    recorder.stop();
  }
}
