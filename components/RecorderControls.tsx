import React from 'react';

interface RecorderControlsProps {
  recordingState: 'idle' | 'starting' | 'recording';
  duration: number;
  includeMic: boolean;
  includeCam: boolean;
  onToggleMic: () => void;
  onToggleCam: () => void;
  onStart: () => void;
  onStop: () => void;
  error: string | null;
}

/**
 * Renders formatted time as HH:MM:SS
 */
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
  onToggleMic,
  onToggleCam,
  onStart,
  onStop,
  error
}) => {
  const isIdle = recordingState === 'idle';
  const isStarting = recordingState === 'starting';
  const isRecording = recordingState === 'recording';

  return (
    <div className="recorder-card">
      <div className="header">
        <div className="icon-wrapper">
          <svg className="recorder-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M12 21C16.9706 21 21 16.9706 21 12C21 7.02944 16.9706 3 12 3C7.02944 3 3 7.02944 3 12C3 16.9706 7.02944 21 12 21Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M15 12C15 13.6569 13.6569 15 12 15C10.3431 15 9 13.6569 9 12C9 10.3431 10.3431 9 12 9C13.6569 9 15 10.3431 15 12Z" fill="currentColor"/>
          </svg>
        </div>
        <h2>Screen Recorder</h2>
      </div>

      {error && (
        <div className="error-banner">
          <svg className="error-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <span>{error}</span>
        </div>
      )}

      {isIdle ? (
        <div className="setup-container">
          <div className="toggle-group">
            <label className="toggle-label">
              <span className="label-text">
                <svg className="toggle-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                </svg>
                Include Microphone
              </span>
              <div className="switch">
                <input
                  type="checkbox"
                  checked={includeMic}
                  onChange={onToggleMic}
                  id="mic-toggle"
                />
                <span className="slider"></span>
              </div>
            </label>

            <label className="toggle-label">
              <span className="label-text">
                <svg className="toggle-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
                Include Camera
              </span>
              <div className="switch">
                <input
                  type="checkbox"
                  checked={includeCam}
                  onChange={onToggleCam}
                  id="cam-toggle"
                />
                <span className="slider"></span>
              </div>
            </label>
          </div>

          <button 
            className="action-btn start-btn" 
            onClick={onStart}
            id="btn-start"
          >
            Start Recording
          </button>
        </div>
      ) : (
        <div className="recording-container">
          <div className="status-display">
            <div className={`status-indicator ${isRecording ? 'pulse' : ''}`} />
            <span className="status-text">
              {isStarting ? 'Setting up...' : 'Recording...'}
            </span>
          </div>

          {!isStarting && (
            <div className="timer" id="recording-timer">
              {formatTime(duration)}
            </div>
          )}

          <button 
            className="action-btn stop-btn" 
            onClick={onStop}
            disabled={isStarting}
            id="btn-stop"
          >
            Stop Recording
          </button>
        </div>
      )}
    </div>
  );
};
