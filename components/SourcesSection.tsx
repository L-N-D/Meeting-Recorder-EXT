import { Camera, Focus, Globe, Mic, Volume2 } from 'lucide-react';
import { Icon } from './Icon';
import type { AudioMixSettings, RecordingState } from '../utils/types';
import { MicLevelMeter } from './MicLevelMeter';
import { SourceCard } from './SourceCard';

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
      <div className="sp-section-title">Capture Sources</div>

      <div className="sources-list" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <SourceCard
          type="mic"
          label="Microphone"
          status={includeMic ? 'Active' : 'Off'}
          active={includeMic}
          disabled={!isIdle}
          onClick={onToggleMic}
          icon={Mic}
        />

        <SourceCard
          type="camera"
          label="Camera Overlay"
          status={includeCam ? 'Active' : 'Off'}
          active={includeCam}
          disabled={!isIdle}
          onClick={onToggleCam}
          icon={Camera}
        />

        <SourceCard
          type="focus"
          label="Focus 1-1 Mode"
          status={focusMode ? 'Active' : 'Off'}
          active={focusMode}
          disabled={!isIdle}
          onClick={onToggleFocusMode}
          icon={Focus}
        />
      </div>

      {focusMode && isIdle && (
        <>
          <p className="sp-hint" style={{ marginTop: 8 }}>
            Focus records the tab you are viewing. Switch tabs and press <strong>Alt+Shift+F</strong> (or right-click → "Add this tab to Focus recording") to target it.
          </p>

          <div className="sp-tabs-box" style={{ marginTop: 8 }}>
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
                <div className="sp-empty">
                  <Icon icon={Globe} size={20} className="sp-favicon-placeholder" />
                  <span className="sp-empty-title">No Recordable Tabs</span>
                  <span className="sp-empty-desc">Open an http:// or https:// tab to target it.</span>
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {includeMic && (
        <div style={{ marginTop: 8 }}>
          <MicLevelMeter enabled={recordingState === 'recording' || isIdle} />
        </div>
      )}

      {includeMic && (
        <div className="sp-audio-mix" style={{ marginTop: 12 }}>
          <div className="sp-section-title sp-section-title--sm">Audio mix</div>
          <div className="sp-range-label">
            <div className="sp-range-row">
              <span>
                <Icon icon={Mic} size={13} />
                Mic Gain
              </span>
              <span className="font-mono">{audioSettings.micGain.toFixed(1)}x</span>
            </div>
            <input
              type="range" min="0.5" max="2" step="0.1"
              value={audioSettings.micGain}
              onChange={(e) =>
                onAudioSettingsChange({ ...audioSettings, micGain: Number(e.target.value) })
              }
            />
          </div>
          <div className="sp-range-label">
            <div className="sp-range-row">
              <span>
                <Icon icon={Volume2} size={13} />
                System Audio
              </span>
              <span className="font-mono">{audioSettings.systemGain.toFixed(1)}x</span>
            </div>
            <input
              type="range" min="0.3" max="1.5" step="0.1"
              value={audioSettings.systemGain}
              onChange={(e) =>
                onAudioSettingsChange({ ...audioSettings, systemGain: Number(e.target.value) })
              }
            />
          </div>
          <div className="sp-switch-row" style={{ marginTop: 4 }}>
            <span className="sp-switch-label" style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>Play system audio while recording</span>
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
          </div>
        </div>
      )}
    </section>
  );
}
