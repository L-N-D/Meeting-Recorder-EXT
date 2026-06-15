import { useState, useEffect } from 'react';
import { RecorderControls } from '../../components/RecorderControls';

function App() {
  const [recordingState, setRecordingState] = useState<'idle' | 'starting' | 'recording'>('idle');
  const [duration, setDuration] = useState<number>(0);
  const [includeMic, setIncludeMic] = useState<boolean>(true);
  const [includeCam, setIncludeCam] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Sync state with background script on mount and listen for broadcasts
  useEffect(() => {
    // 1. Fetch initial status from background service worker
    chrome.runtime.sendMessage({ type: 'GET_RECORDING_STATUS' }, (response) => {
      if (chrome.runtime.lastError) {
        console.error('Failed to get recording status:', chrome.runtime.lastError);
        return;
      }
      if (response) {
        setRecordingState(response.recordingState);
        setDuration(response.duration);
        setIncludeMic(response.includeMic);
        setIncludeCam(response.includeCam);
        setError(response.error);
      }
    });

    // 2. Listen to state changes broadcasted by background worker
    const handleMessage = (message: any) => {
      if (message.type === 'STATE_CHANGED' && message.state) {
        setRecordingState(message.state.recordingState);
        setDuration(message.state.duration);
        setError(message.state.error);
        setIncludeMic(message.state.includeMic);
        setIncludeCam(message.state.includeCam);
      }
    };

    chrome.runtime.onMessage.addListener(handleMessage);
    
    return () => {
      chrome.runtime.onMessage.removeListener(handleMessage);
    };
  }, []);

  const handleStartRecording = async () => {
    setError(null);
    setRecordingState('starting');

    // Check if permissions are already granted using the Permissions API
    let micGranted = true;
    let camGranted = true;

    try {
      if (includeMic) {
        const res = await navigator.permissions.query({ name: 'microphone' as any });
        micGranted = res.state === 'granted';
      }
      if (includeCam) {
        const res = await navigator.permissions.query({ name: 'camera' as any });
        camGranted = res.state === 'granted';
      }
    } catch (e) {
      // Fallback: If query is unsupported or fails, check via prompt tab
      micGranted = false;
      camGranted = false;
    }

    // If any selected permission is not granted, open the onboarding permissions tab
    if ((includeMic && !micGranted) || (includeCam && !camGranted)) {
      chrome.tabs.create({
        url: `permissions.html?mic=${includeMic}&cam=${includeCam}`
      });
      window.close(); // Close transient popup so user can focus on the tab
      return;
    }

    // If permissions are already granted, run a hardware check to ensure devices are connected
    if (includeMic) {
      try {
        const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        micStream.getTracks().forEach((track) => track.stop());
      } catch (err: any) {
        console.warn('Microphone hardware check failed:', err);
        if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
          setError('Microphone device not found. Please connect a microphone or uncheck "Include Microphone".');
        } else {
          setError(`Microphone access error: ${err.message || 'Permission denied'}`);
        }
        setRecordingState('idle');
        return;
      }
    }

    if (includeCam) {
      try {
        const camStream = await navigator.mediaDevices.getUserMedia({ video: true });
        camStream.getTracks().forEach((track) => track.stop());
      } catch (err: any) {
        console.warn('Camera hardware check failed:', err);
        if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
          setError('Camera device not found. Please connect a webcam or uncheck "Include Camera".');
        } else {
          setError(`Camera access error: ${err.message || 'Permission denied'}`);
        }
        setRecordingState('idle');
        return;
      }
    }

    chrome.runtime.sendMessage({
      type: 'START_RECORDING_FLOW',
      includeMic,
      includeCam
    }, (response) => {
      if (chrome.runtime.lastError) {
        setError(`Failed to connect to background worker: ${chrome.runtime.lastError.message}`);
        setRecordingState('idle');
      }
    });
  };

  const handleStopRecording = () => {
    chrome.runtime.sendMessage({ type: 'STOP_RECORDING_FLOW' }, (response) => {
      if (chrome.runtime.lastError) {
        setError(`Failed to stop recording: ${chrome.runtime.lastError.message}`);
      }
    });
  };

  return (
    <RecorderControls
      recordingState={recordingState}
      duration={duration}
      includeMic={includeMic}
      includeCam={includeCam}
      onToggleMic={() => setIncludeMic(!includeMic)}
      onToggleCam={() => setIncludeCam(!includeCam)}
      onStart={handleStartRecording}
      onStop={handleStopRecording}
      error={error}
    />
  );
}

export default App;
