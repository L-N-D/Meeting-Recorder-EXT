import { Camera, Focus, Globe, Mic, Volume2 } from 'lucide-react';
import { Icon } from './Icon';
import type { AudioMixSettings, RecordingState } from '../utils/types';
import { MicLevelMeter } from './MicLevelMeter';

interface SourcesSectionProps {
  recordingState: RecordingState;
  includeMic: boolean;
  includeCam: boolean;
  focusMode: boolean;
  audioSettings: AudioMixSettings;
  onToggleMic: () => void;
  onToggleCam: () => void;
  onToggleFocusMode: () => void;
  onAudioSettingsChange: (s: AudioMixSettings) => void;
  tabsList: chrome.tabs.Tab[];
  selectedTabIds: number[];
  activeTabId: number | null;
  onToggleTabSelection: (id: number) => void;
  onSelectAllTabs: () => void;
  onClearTabSelection: () => void;
}

export function SourcesSection({
  recordingState,
  includeMic,
  includeCam,
  focusMode,
  audioSettings,
  onToggleMic,
  onToggleCam,
  onToggleFocusMode,
  onAudioSettingsChange,
  tabsList,
  selectedTabIds,
  activeTabId,
  onToggleTabSelection,
  onSelectAllTabs,
  onClearTabSelection,
}: SourcesSectionProps) {
  const isIdle = recordingState === 'idle';

  return (
    <section className="sp-section">
      <div className="sp-section-title">Sources</div>

      <div className="sp-toggle-group">
        <label className="sp-toggle-row">
          <span className="sp-toggle-label">
            <Icon icon={Mic} size={15} />
            Microphone
          </span>
          <label className="sp-switch">
            <input type="checkbox" checked={includeMic} onChange={onToggleMic} disabled={!isIdle} />
            <span className="sp-slider" />
          </label>
        </label>

        <label className="sp-toggle-row">
          <span className="sp-toggle-label">
            <Icon icon={Camera} size={15} />
            Camera overlay
          </span>
          <label className="sp-switch">
            <input type="checkbox" checked={includeCam} onChange={onToggleCam} disabled={!isIdle} />
            <span className="sp-slider" />
          </label>
        </label>

        <label className="sp-toggle-row">
          <span className="sp-toggle-label">
            <Icon icon={Focus} size={15} />
            Focus 1-1
          </span>
          <label className="sp-switch">
            <input
              type="checkbox"
              checked={focusMode}
              onChange={onToggleFocusMode}
              disabled={!isIdle}
            />
            <span className="sp-slider" />
          </label>
        </label>
      </div>

      {focusMode && isIdle && (
        <>
          <p className="sp-hint">
            Start records the tab you're currently viewing. To follow another tab while recording,
            switch to it and press <strong>Alt+Shift+F</strong> (or right-click → "Add this tab to
            Focus recording"). Switching back is automatic.
          </p>

          <div className="sp-tabs-box">
            <div className="sp-tabs-header">
              <span className="sp-tabs-title">
                Monitored tabs
                <span className="sp-count-badge">{selectedTabIds.length}</span>
              </span>
              <div className="sp-tabs-actions">
                <button className="sp-link-btn" onClick={onSelectAllTabs}>All</button>
                <button className="sp-link-btn" onClick={onClearTabSelection}>Clear</button>
              </div>
            </div>
            <div className="sp-tabs-list">
              {tabsList.length > 0 ? (
                tabsList.map((tab) => {
                  const checked = selectedTabIds.includes(tab.id!);
                  const isActive = tab.id === activeTabId;
                  return (
                    <label
                      key={tab.id}
                      className={`sp-tab-item ${checked ? 'sp-tab-item--selected' : ''} ${isActive ? 'sp-tab-item--active' : ''}`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => onToggleTabSelection(tab.id!)}
                      />
                      {tab.favIconUrl ? (
                        <img src={tab.favIconUrl} className="sp-favicon" alt="" />
                      ) : (
                        <span className="sp-favicon-placeholder">
                          <Icon icon={Globe} size={13} />
                        </span>
                      )}
                      <span className="sp-tab-title" title={tab.title}>
                        {tab.title || tab.url || `Tab ${tab.id}`}
                      </span>
                      {isActive && <span className="sp-active-badge">Current</span>}
                    </label>
                  );
                })
              ) : (
                <div className="sp-empty">No recordable tabs open (http/https only).</div>
              )}
            </div>
          </div>
        </>
      )}

      {includeMic && isIdle && <MicLevelMeter enabled />}

      {includeMic && isIdle && (
        <div className="sp-audio-mix">
          <div className="sp-section-title sp-section-title--sm">Audio mix</div>
          <label className="sp-range-label">
            <span className="sp-range-row">
              <Icon icon={Mic} size={13} />
              Mic — {audioSettings.micGain.toFixed(1)}×
            </span>
            <input
              type="range" min="0.5" max="2" step="0.1"
              value={audioSettings.micGain}
              onChange={(e) =>
                onAudioSettingsChange({ ...audioSettings, micGain: Number(e.target.value) })
              }
            />
          </label>
          <label className="sp-range-label">
            <span className="sp-range-row">
              <Icon icon={Volume2} size={13} />
              System audio — {audioSettings.systemGain.toFixed(1)}×
            </span>
            <input
              type="range" min="0.3" max="1.5" step="0.1"
              value={audioSettings.systemGain}
              onChange={(e) =>
                onAudioSettingsChange({ ...audioSettings, systemGain: Number(e.target.value) })
              }
            />
          </label>
          <label className="sp-toggle-row sp-toggle-row--compact">
            <span className="sp-toggle-label">Play system audio while recording</span>
            <label className="sp-switch">
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
              <span className="sp-slider" />
            </label>
          </label>
        </div>
      )}
    </section>
  );
}
