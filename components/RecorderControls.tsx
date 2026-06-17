import React from 'react';
import {
  AlertTriangle,
  Camera,
  CircleDot,
  Focus,
  Globe,
  Mic,
  Pause,
  Play,
  Square,
  Volume2,
  X,
} from 'lucide-react';
import { Icon } from './Icon';
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
  showArmCurrentTab?: boolean;
  onArmCurrentTab?: () => void;
  error: string | null;
  onDismissError?: () => void;
  micMeter?: React.ReactNode;
  tabsList?: chrome.tabs.Tab[];
  selectedTabIds?: number[];
  activeTabId?: number | null;
  onToggleTabSelection?: (tabId: number) => void;
  onSelectAllTabs?: () => void;
  onClearTabSelection?: () => void;
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
  showArmCurrentTab = false,
  onArmCurrentTab,
  error,
  onDismissError,
  micMeter,
  tabsList = [],
  selectedTabIds = [],
  activeTabId = null,
  onToggleTabSelection,
  onSelectAllTabs,
  onClearTabSelection,
}) => {
  const isIdle = recordingState === 'idle';
  const isStarting = recordingState === 'starting';
  const isRecording = recordingState === 'recording';
  const isPaused = recordingState === 'paused';
  const isStopping = isStarting && duration > 0;

  return (
    <div className="recorder-card">
      <div className="header">
        <div className="icon-wrapper">
          <Icon icon={CircleDot} size={20} className="header-logo-icon" />
        </div>
        <div className="header-text">
          <h2>Screen Recorder</h2>
          <p className="header-subtitle">Record screen, mic, and tab focus</p>
        </div>
      </div>

      {error && (
        <div className="error-banner" role="alert">
          <Icon icon={AlertTriangle} size={16} className="error-icon" />
          <span className="error-text">{error}</span>
          {onDismissError && isIdle && (
            <button type="button" className="error-dismiss" onClick={onDismissError} aria-label="Dismiss">
              <Icon icon={X} size={16} />
            </button>
          )}
        </div>
      )}

      {isIdle ? (
        <div className="setup-container">
          <div className="section-label">Sources</div>
          <div className="toggle-group">
            <label className="toggle-label">
              <span className="label-text">
                <Icon icon={Mic} size={16} className="option-icon" />
                Microphone
              </span>
              <div className="switch">
                <input type="checkbox" checked={includeMic} onChange={onToggleMic} id="mic-toggle" />
                <span className="slider"></span>
              </div>
            </label>

            <label className="toggle-label">
              <span className="label-text">
                <Icon icon={Camera} size={16} className="option-icon" />
                Camera overlay
              </span>
              <div className="switch">
                <input type="checkbox" checked={includeCam} onChange={onToggleCam} id="cam-toggle" />
                <span className="slider"></span>
              </div>
            </label>

            <label className="toggle-label">
              <span className="label-text">
                <Icon icon={Focus} size={16} className="option-icon" />
                Focus 1-1
              </span>
              <div className="switch">
                <input type="checkbox" checked={focusMode} onChange={onToggleFocusMode} id="focus-toggle" />
                <span className="slider"></span>
              </div>
            </label>

            {focusMode && (
              <div className="focus-hint">
                Start records the tab you are viewing now. To follow another tab while
                recording, switch to it and press <strong>Alt+Shift+F</strong> (or right-click the
                page → <strong>“Add this tab to Focus recording”</strong>). After a tab is added,
                switching back to it is automatic.
              </div>
            )}

            {focusMode && (
              <div className="tabs-selection-container">
                <div className="tabs-selection-header">
                  <div className="tabs-selection-title">
                    Monitored tabs
                    <span className="tab-count-badge">{selectedTabIds.length}</span>
                  </div>
                  <div className="tabs-selection-actions">
                    <button type="button" className="link-btn" onClick={onSelectAllTabs}>
                      All
                    </button>
                    <button type="button" className="link-btn" onClick={onClearTabSelection}>
                      Clear
                    </button>
                  </div>
                </div>
                <div className="tabs-list">
                  {tabsList.length > 0 ? (
                    tabsList.map((tab) => {
                      const isChecked = selectedTabIds.includes(tab.id!);
                      const isActive = tab.id === activeTabId;
                      return (
                        <label
                          key={tab.id}
                          className={`tab-item-label ${isChecked ? 'selected' : ''} ${isActive ? 'active-tab' : ''}`}
                        >
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => onToggleTabSelection?.(tab.id!)}
                          />
                          {tab.favIconUrl ? (
                            <img src={tab.favIconUrl} className="tab-favicon" alt="" />
                          ) : (
                            <span className="tab-favicon-placeholder">
                              <Icon icon={Globe} size={14} />
                            </span>
                          )}
                          <span className="tab-title-text" title={tab.title}>
                            {tab.title || tab.url || `Tab ${tab.id}`}
                          </span>
                          {isActive && <span className="active-badge">Current</span>}
                        </label>
                      );
                    })
                  ) : (
                    <div className="empty-tabs-msg">No recordable tabs open (http/https only).</div>
                  )}
                </div>
              </div>
            )}
          </div>

          {includeMic && micMeter}

          {includeMic && (
            <div className="audio-settings">
              <div className="section-label">Audio mix</div>
              <label className="range-label">
                <span className="range-label-row">
                  <Icon icon={Mic} size={14} className="range-icon" />
                  Mic gain — {audioSettings.micGain.toFixed(1)}x
                </span>
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
                <span className="range-label-row">
                  <Icon icon={Volume2} size={14} className="range-icon" />
                  System audio — {audioSettings.systemGain.toFixed(1)}x
                </span>
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
                <span className="label-text">Play system audio while recording</span>
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
            <Icon icon={CircleDot} size={18} className="start-btn-icon" />
            Start Recording
          </button>
        </div>
      ) : (
        <div className="recording-container">
          <div className="status-display">
            <div
              className={`status-indicator ${isRecording ? 'pulse' : ''} ${isPaused ? 'paused' : ''}`}
            />
            <span className="status-text">
              {isStopping
                ? 'Saving recording...'
                : isStarting
                  ? 'Setting up capture...'
                  : isPaused
                    ? 'Paused'
                    : 'Recording'}
            </span>
          </div>

          {!isStarting && <div className="timer" id="recording-timer">{formatTime(duration)}</div>}

          {isStopping && (
            <p className="saving-hint">Finalizing video — please wait a moment.</p>
          )}

          {isStarting && !isStopping && (
            <p className="saving-hint">
              If a “Share your screen” dialog appears, pick a source to begin. This can take a few seconds.
            </p>
          )}

          {!isStarting && !isStopping && (
            <p className="recording-hint">Controls stay here in the extension popup.</p>
          )}

          {(isRecording || isPaused) && showArmCurrentTab && (
            <div className="arm-tab-prompt">
              <p className="arm-tab-text">
                The tab you are viewing is not being recorded yet.
              </p>
              <button
                type="button"
                className="action-btn arm-tab-btn"
                onClick={onArmCurrentTab}
                id="btn-arm-tab"
              >
                <Icon icon={Focus} size={16} />
                Record this tab
              </button>
            </div>
          )}

          <div className="recording-actions">
            {isRecording && (
              <button className="action-btn pause-btn" onClick={onPause} id="btn-pause">
                <Icon icon={Pause} size={16} />
                Pause
              </button>
            )}
            {isPaused && (
              <button className="action-btn resume-btn" onClick={onResume} id="btn-resume">
                <Icon icon={Play} size={16} />
                Resume
              </button>
            )}
            <button
              className="action-btn stop-btn"
              onClick={onStop}
              disabled={isStarting}
              id="btn-stop"
            >
              <Icon icon={Square} size={16} />
              {isStopping ? 'Saving...' : 'Stop & Save'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
