import React from 'react';
import type { AudioMixSettings, RecordingState } from '../utils/types';

interface RecorderControlsProps {
  recordingState: RecordingState;
  duration: number;
  includeMic: boolean;
  includeCam: boolean;
  focusMode: boolean;
  audioSettings: AudioMixSettings;
  onToggleMic: () => void;
  onToggleCam: () => void;
  onToggleFocusMode: () => void;
  onAudioSettingsChange: (settings: AudioMixSettings) => void;
  onStart: () => void;
  onStop: () => void;
  onPause: () => void;
  onResume: () => void;
  error: string | null;
  micMeter?: React.ReactNode;
}

const formatTime = (totalSeconds: number): string => {
  const hrs = Math.floor(totalSeconds / 3600);
  const mins = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;
  const pad = (num: number) => String(num).padStart(2, '0');

  if (hrs > 0) {
    return `${pad(hrs)}:${pad(mins)}:${pad(secs)}`;
  }
  return `${pad(mins)}:${pad(secs)}`;
};

export const RecorderControls: React.FC<RecorderControlsProps> = ({
  recordingState,
  duration,
  includeMic,
  includeCam,
  focusMode,
  audioSettings,
  onToggleMic,
  onToggleCam,
  onToggleFocusMode,
  onAudioSettingsChange,
  onStart,
  onStop,
  onPause,
  onResume,
  error,
  micMeter,
}) => {
  const isIdle = recordingState === 'idle';
  const isStarting = recordingState === 'starting';
  const isRecording = recordingState === 'recording';
  const isPaused = recordingState === 'paused';

  return (
    <div className="recorder-card">
      <div className="header">
        <div className="icon-wrapper">
          <svg className="recorder-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path
              d="M12 21C16.9706 21 21 16.9706 21 12C21 7.02944 16.9706 3 12 3C7.02944 3 3 7.02944 3 12C3 16.9706 7.02944 21 12 21Z"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M15 12C15 13.6569 13.6569 15 12 15C10.3431 15 9 13.6569 9 12C9 10.3431 10.3431 9 12 9C13.6569 9 15 10.3431 15 12Z"
              fill="currentColor"
            />
          </svg>
        </div>
        <h2>Screen Recorder</h2>
      </div>

      {error && (
        <div className="error-banner">
          <svg className="error-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
          <span>{error}</span>
        </div>
      )}

      {isIdle ? (
        <div className="setup-container">
          <div className="toggle-group">
            <label className="toggle-label">
              <span className="label-text">Include Microphone</span>
              <div className="switch">
                <input type="checkbox" checked={includeMic} onChange={onToggleMic} id="mic-toggle" />
                <span className="slider"></span>
              </div>
            </label>

            <label className="toggle-label">
              <span className="label-text">Include Camera</span>
              <div className="switch">
                <input type="checkbox" checked={includeCam} onChange={onToggleCam} id="cam-toggle" />
                <span className="slider"></span>
              </div>
            </label>

            <label className="toggle-label">
              <span className="label-text">Focus 1-1 (auto switch tabs)</span>
              <div className="switch">
                <input type="checkbox" checked={focusMode} onChange={onToggleFocusMode} id="focus-toggle" />
                <span className="slider"></span>
              </div>
            </label>
          </div>

          {includeMic && micMeter}

          {includeMic && (
            <div className="audio-settings">
              <label className="range-label">
                Mic gain ({audioSettings.micGain.toFixed(1)})
                <input
                  type="range"
                  min="0.5"
                  max="2"
                  step="0.1"
                  value={audioSettings.micGain}
                  onChange={(event) =>
                    onAudioSettingsChange({
                      ...audioSettings,
                      micGain: Number(event.target.value),
                    })
                  }
                />
              </label>
              <label className="range-label">
                System audio ({audioSettings.systemGain.toFixed(1)})
                <input
                  type="range"
                  min="0.3"
                  max="1.5"
                  step="0.1"
                  value={audioSettings.systemGain}
                  onChange={(event) =>
                    onAudioSettingsChange({
                      ...audioSettings,
                      systemGain: Number(event.target.value),
                    })
                  }
                />
              </label>
              <label className="toggle-label compact">
                <span className="label-text">Monitor system audio (may echo)</span>
                <div className="switch">
                  <input
                    type="checkbox"
                    checked={audioSettings.routeSystemToSpeakers}
                    onChange={() =>
                      onAudioSettingsChange({
                        ...audioSettings,
                        routeSystemToSpeakers: !audioSettings.routeSystemToSpeakers,
                      })
                    }
                  />
                  <span className="slider"></span>
                </div>
              </label>
            </div>
          )}

          <button className="action-btn start-btn" onClick={onStart} id="btn-start">
            Start Recording
          </button>
        </div>
      ) : (
        <div className="recording-container">
          <div className="status-display">
            <div className={`status-indicator ${isRecording ? 'pulse' : ''}`} />
            <span className="status-text">
              {isStarting ? 'Setting up...' : isPaused ? 'Paused' : 'Recording...'}
            </span>
          </div>

          {!isStarting && <div className="timer" id="recording-timer">{formatTime(duration)}</div>}

          <div className="recording-actions">
            {isRecording && (
              <button className="action-btn pause-btn" onClick={onPause} id="btn-pause">
                Pause
              </button>
            )}
            {isPaused && (
              <button className="action-btn resume-btn" onClick={onResume} id="btn-resume">
                Resume
              </button>
            )}
            <button className="action-btn stop-btn" onClick={onStop} disabled={isStarting} id="btn-stop">
              Stop Recording
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
