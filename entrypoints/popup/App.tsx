import { useState, useEffect } from 'react';
import { MicLevelMeter } from '../../components/MicLevelMeter';
import { RecorderControls } from '../../components/RecorderControls';
import {
  DEFAULT_AUDIO_SETTINGS,
  type AudioMixSettings,
  type RecordingState,
} from '../../utils/types';

function App() {
  const [recordingState, setRecordingState] = useState<RecordingState>('idle');
  const [duration, setDuration] = useState<number>(0);
  const [includeMic, setIncludeMic] = useState<boolean>(true);
  const [includeCam, setIncludeCam] = useState<boolean>(false);
  const [focusMode, setFocusMode] = useState<boolean>(false);
  const [audioSettings, setAudioSettings] = useState<AudioMixSettings>({
    ...DEFAULT_AUDIO_SETTINGS,
  });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
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
        setFocusMode(response.focusMode ?? false);
        setAudioSettings(response.audioSettings ?? { ...DEFAULT_AUDIO_SETTINGS });
        setError(response.error);
      }
    });

    const handleMessage = (message: any) => {
      if (message.type === 'STATE_CHANGED' && message.state) {
        setRecordingState(message.state.recordingState);
        setDuration(message.state.duration);
        setError(message.state.error);
        setIncludeMic(message.state.includeMic);
        setIncludeCam(message.state.includeCam);
        setFocusMode(message.state.focusMode ?? false);
        setAudioSettings(message.state.audioSettings ?? { ...DEFAULT_AUDIO_SETTINGS });
      }
    };

    chrome.runtime.onMessage.addListener(handleMessage);

    return () => {
      chrome.runtime.onMessage.removeListener(handleMessage);
    };
  }, []);

  const sendStartRecording = () => {
    chrome.runtime.sendMessage(
      {
        type: 'START_RECORDING_FLOW',
        includeMic,
        includeCam,
        focusMode,
        audioSettings,
      },
      () => {
        if (chrome.runtime.lastError) {
          setError(`Failed to connect to background worker: ${chrome.runtime.lastError.message}`);
          setRecordingState('idle');
        }
      }
    );
  };

  const handleStartRecording = async () => {
    setError(null);
    setRecordingState('starting');

    let micGranted = true;
    let camGranted = true;

    try {
      if (includeMic) {
        const res = await navigator.permissions.query({ name: 'microphone' as PermissionName });
        micGranted = res.state === 'granted';
      }
      if (includeCam) {
        const res = await navigator.permissions.query({ name: 'camera' as PermissionName });
        camGranted = res.state === 'granted';
      }
    } catch {
      micGranted = false;
      camGranted = false;
    }

    if ((includeMic && !micGranted) || (includeCam && !camGranted)) {
      chrome.runtime.sendMessage({
        type: 'SET_PENDING_RECORDING',
        includeMic,
        includeCam,
        focusMode,
        audioSettings,
      });

      chrome.tabs.create({
        url: `permissions.html?mic=${includeMic}&cam=${includeCam}&focus=${focusMode}`,
      });
      window.close();
      return;
    }

    if (includeMic) {
      try {
        const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        micStream.getTracks().forEach((track) => track.stop());
      } catch (err: any) {
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
        if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
          setError('Camera device not found. Please connect a webcam or uncheck "Include Camera".');
        } else {
          setError(`Camera access error: ${err.message || 'Permission denied'}`);
        }
        setRecordingState('idle');
        return;
      }
    }

    sendStartRecording();
  };

  const handleStopRecording = () => {
    chrome.runtime.sendMessage({ type: 'STOP_RECORDING_FLOW' }, () => {
      if (chrome.runtime.lastError) {
        setError(`Failed to stop recording: ${chrome.runtime.lastError.message}`);
      }
    });
  };

  const handlePauseRecording = () => {
    chrome.runtime.sendMessage({ type: 'PAUSE_RECORDING_FLOW' });
  };

  const handleResumeRecording = () => {
    chrome.runtime.sendMessage({ type: 'RESUME_RECORDING_FLOW' });
  };

  return (
    <RecorderControls
      recordingState={recordingState}
      duration={duration}
      includeMic={includeMic}
      includeCam={includeCam}
      focusMode={focusMode}
      audioSettings={audioSettings}
      onToggleMic={() => setIncludeMic(!includeMic)}
      onToggleCam={() => setIncludeCam(!includeCam)}
      onToggleFocusMode={() => setFocusMode(!focusMode)}
      onAudioSettingsChange={setAudioSettings}
      onStart={handleStartRecording}
      onStop={handleStopRecording}
      onPause={handlePauseRecording}
      onResume={handleResumeRecording}
      error={error}
      micMeter={<MicLevelMeter enabled={includeMic && recordingState === 'idle'} />}
    />
  );
}

export default App;
