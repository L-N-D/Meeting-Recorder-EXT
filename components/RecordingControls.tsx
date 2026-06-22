import { AlertTriangle, CircleDot, Focus, Pause, Play, Square, X } from 'lucide-react';
import { Icon } from './Icon';
import type { RecordingState } from '../utils/types';
import { formatTime } from '../utils/format';

interface RecordingControlsProps {
  recordingState: RecordingState;
  duration: number;
  error: string | null;
  showArmCurrentTab?: boolean;
  onStart: () => void;
  onStop: () => void;
  onPause: () => void;
  onResume: () => void;
  onArmCurrentTab?: () => void;
  onDismissError?: () => void;
}



export function RecordingControls({
  recordingState,
  duration,
  error,
  showArmCurrentTab = false,
  onStart,
  onStop,
  onPause,
  onResume,
  onArmCurrentTab,
  onDismissError,
}: RecordingControlsProps) {
  const isIdle = recordingState === 'idle';
  const isStarting = recordingState === 'starting';
  const isRecording = recordingState === 'recording';
  const isPaused = recordingState === 'paused';
  const isStopping = isStarting && duration > 0;

  // Map to a user-friendly label
  const statusLabel = () => {
    if (isStopping) return 'Saving…';
    if (isStarting) return 'Setting up…';
    if (isPaused) return 'Paused';
    if (isRecording) return 'Recording';
    return 'Idle';
  };

  return (
    <section className="sp-section" style={{ borderBottom: 'none' }}>
      {isIdle && <div className="sp-section-title">Recording</div>}

      {error && (
        <div className="sp-error-banner" role="alert">
          <Icon icon={AlertTriangle} size={14} className="sp-error-icon" />
          <span className="sp-error-text">{error}</span>
          {isIdle && onDismissError && (
            <button className="sp-error-dismiss" onClick={onDismissError} aria-label="Dismiss">
              <Icon icon={X} size={14} />
            </button>
          )}
        </div>
      )}

      {/* Main recording panel (shown while active) */}
      {!isIdle && (
        <div className="recording-panel">
          <div className="timer-display">
            <span className={`pulse-indicator ${isRecording || isStarting ? 'pulse-active' : 'pulse-paused'}`} />
            {formatTime(duration)} / 30:00
          </div>
          <div className="recording-status-text">{statusLabel()}</div>

          {/* Action buttons */}
          <div className="sp-actions-row">
            {isRecording && (
              <button className="sp-btn sp-btn--secondary" onClick={onPause}>
                <Icon icon={Pause} size={14} />
                Pause
              </button>
            )}
            {isPaused && (
              <button className="sp-btn sp-btn--secondary" onClick={onResume}>
                <Icon icon={Play} size={14} />
                Resume
              </button>
            )}
            {(isRecording || isPaused) && (
              <button className="sp-btn sp-btn--stop" onClick={onStop} disabled={isStarting}>
                <Icon icon={Square} size={14} />
                {isStopping ? 'Saving…' : 'Stop'}
              </button>
            )}
            {isStopping && (
              <button className="sp-btn sp-btn--stop" disabled>
                <Icon icon={Square} size={14} />
                Saving…
              </button>
            )}
          </div>
        </div>
      )}

      {isIdle && (
        <div className="btn-record-container">
          <button className="btn-record-main" onClick={onStart}>
            <Icon icon={CircleDot} size={28} />
            <span className="btn-record-main-label">Start</span>
          </button>
        </div>
      )}

      {isStarting && !isStopping && (
        <p className="sp-hint" style={{ textAlign: 'center', marginTop: 4 }}>
          Choose a screen or window source in the browser popup to begin recording.
        </p>
      )}
      {isStopping && (
        <p className="sp-hint" style={{ textAlign: 'center', marginTop: 4 }}>
          Finalizing video — please wait a moment.
        </p>
      )}

      {/* Arm tab (Focus 1-1 while recording) */}
      {(isRecording || isPaused) && showArmCurrentTab && (
        <div className="sp-arm-prompt" style={{ marginTop: 12 }}>
          <p className="sp-arm-text">The tab you are viewing is not being recorded yet.</p>
          <button className="sp-btn sp-btn--secondary sp-btn--sm" onClick={onArmCurrentTab} style={{ alignSelf: 'flex-start' }}>
            <Icon icon={Focus} size={13} />
            Record this tab
          </button>
        </div>
      )}
    </section>
  );
}
