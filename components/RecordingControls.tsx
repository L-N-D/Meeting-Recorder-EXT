import { AlertTriangle, CircleDot, Focus, Pause, Play, Square, X } from 'lucide-react';
import { Icon } from './Icon';
import type { RecordingState } from '../utils/types';

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

function formatTime(totalSeconds: number): string {
  const hrs = Math.floor(totalSeconds / 3600);
  const mins = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return hrs > 0
    ? `${pad(hrs)}:${pad(mins)}:${pad(secs)}`
    : `${pad(mins)}:${pad(secs)}`;
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
    <section className="sp-section">
      <div className="sp-section-title">Recording</div>

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

      {/* Status row (shown while active) */}
      {!isIdle && (
        <div className="sp-status-row">
          <span
            className={`sp-dot ${isRecording ? 'sp-dot--pulse' : isPaused ? 'sp-dot--paused' : 'sp-dot--starting'}`}
          />
          <span className="sp-status-text">{statusLabel()}</span>
          {!isStarting && (
            <span className="sp-timer">{formatTime(duration)}</span>
          )}
        </div>
      )}

      {isStarting && !isStopping && (
        <p className="sp-hint">
          If a "Share your screen" dialog appears, pick a source to begin.
        </p>
      )}
      {isStopping && (
        <p className="sp-hint">Finalizing video — please wait a moment.</p>
      )}

      {/* Arm tab (Focus 1-1 while recording) */}
      {(isRecording || isPaused) && showArmCurrentTab && (
        <div className="sp-arm-prompt">
          <p className="sp-arm-text">The tab you're viewing isn't being recorded yet.</p>
          <button className="sp-btn sp-btn--secondary" onClick={onArmCurrentTab}>
            <Icon icon={Focus} size={14} />
            Record this tab
          </button>
        </div>
      )}

      {/* Action buttons */}
      <div className="sp-actions-row">
        {isIdle && (
          <button className="sp-btn sp-btn--start" onClick={onStart}>
            <Icon icon={CircleDot} size={16} />
            Start Recording
          </button>
        )}
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
            {isStopping ? 'Saving…' : 'Stop & Save'}
          </button>
        )}
        {isStopping && (
          <button className="sp-btn sp-btn--stop" disabled>
            <Icon icon={Square} size={14} />
            Saving…
          </button>
        )}
      </div>
    </section>
  );
}
