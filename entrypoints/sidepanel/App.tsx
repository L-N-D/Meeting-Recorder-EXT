import { useCallback, useEffect, useRef, useState } from 'react';
import { AudioCapturePermission } from '../../components/AudioCapturePermission';
import { AudioHelperSection } from '../../components/AudioHelperSection';
import { LogsSection } from '../../components/LogsSection';
import { RecordingControls } from '../../components/RecordingControls';
import { SourcesSection } from '../../components/SourcesSection';
import {
  DEFAULT_APP_AUDIO_STATE,
  DEFAULT_AUDIO_SETTINGS,
  type AppAudioState,
  type AudioMixSettings,
  type LogLine,
  type RecordingState,
} from '../../utils/types';
import {
  needsVirtualAudioCapture,
  isAudioCaptureReady,
  markAudioCaptureGranted,
} from '../../utils/audioCapturePermission';

const CAPTURABLE_URL_PREFIXES = ['http://', 'https://'];

function isCapturableTab(tab: chrome.tabs.Tab): boolean {
  if (!tab.id || tab.id <= 0 || !tab.url) return false;
  return CAPTURABLE_URL_PREFIXES.some((p) => tab.url!.startsWith(p));
}

export default function App() {
  // ---- Recording state (synced from background) ----------------------------
  const [recordingState, setRecordingState] = useState<RecordingState>('idle');
  const [duration, setDuration] = useState(0);
  const [includeMic, setIncludeMic] = useState(true);
  const [includeCam, setIncludeCam] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [audioSettings, setAudioSettings] = useState<AudioMixSettings>({
    ...DEFAULT_AUDIO_SETTINGS,
  });
  const [error, setError] = useState<string | null>(null);
  const [appAudio, setAppAudio] = useState<AppAudioState>({ ...DEFAULT_APP_AUDIO_STATE });

  // ---- Focus 1-1 state -----------------------------------------------------
  const [activeTabId, setActiveTabId] = useState<number | null>(null);
  const [tabsList, setTabsList] = useState<chrome.tabs.Tab[]>([]);
  const [selectedTabIds, setSelectedTabIds] = useState<number[]>([]);
  const [activeTabArmed, setActiveTabArmed] = useState(true);
  const [activeTabCapturable, setActiveTabCapturable] = useState(false);

  // ---- Log lines -----------------------------------------------------------
  const [logLines, setLogLines] = useState<LogLine[]>([]);
  const logsRef = useRef<LogLine[]>([]);

  // ---- Sync from background ------------------------------------------------

  const syncFromBackground = useCallback(
    (state: {
      recordingState: RecordingState;
      duration: number;
      error: string | null;
      includeMic: boolean;
      includeCam: boolean;
      focusMode: boolean;
      audioSettings: AudioMixSettings;
      appAudio?: AppAudioState;
    }) => {
      setRecordingState(state.recordingState);
      setDuration(state.duration);
      setError(state.error);
      setIncludeMic(state.includeMic);
      setIncludeCam(state.includeCam);
      setFocusMode(state.focusMode ?? false);
      setAudioSettings(state.audioSettings ?? { ...DEFAULT_AUDIO_SETTINGS });
      if (state.appAudio) setAppAudio(state.appAudio);
    },
    []
  );

  useEffect(() => {
    // Initial state fetch
    chrome.runtime.sendMessage({ type: 'GET_RECORDING_STATUS' }, (response) => {
      if (chrome.runtime.lastError || !response) return;
      syncFromBackground(response);
    });

    // Initial log buffer
    chrome.runtime.sendMessage({ type: 'GET_LOG_BUFFER' }, (response) => {
      if (chrome.runtime.lastError || !response) return;
      const lines: LogLine[] = response.lines ?? [];
      logsRef.current = lines;
      setLogLines([...lines]);
    });

    const handleMessage = (message: any) => {
      if (message.type === 'STATE_CHANGED' && message.state) {
        syncFromBackground(message.state);
      }
      if (message.type === 'LOG_LINE' && message.line) {
        logsRef.current = [...logsRef.current.slice(-99), message.line];
        setLogLines([...logsRef.current]);
      }
    };

    chrome.runtime.onMessage.addListener(handleMessage);
    return () => chrome.runtime.onMessage.removeListener(handleMessage);
  }, [syncFromBackground]);

  // ---- Focus 1-1 tab list (idle only) --------------------------------------

  useEffect(() => {
    if (!focusMode || recordingState !== 'idle') return;
    chrome.tabs.query({ windowType: 'normal' }, (tabs) => {
      if (chrome.runtime.lastError) return;
      const filteredTabs = tabs.filter(isCapturableTab);
      setTabsList(filteredTabs);
      chrome.tabs.query({ active: true, currentWindow: true }, (activeTabs) => {
        const activeTab = activeTabs[0];
        if (activeTab?.id) {
          setActiveTabId(activeTab.id);
          setSelectedTabIds((prev) => {
            if (prev.length === 0 && isCapturableTab(activeTab)) return [activeTab.id!];
            return prev;
          });
        }
      });
    });
  }, [focusMode, recordingState]);

  // ---- Active tab arming check (while recording in Focus mode) -------------

  const refreshActiveTabArming = useCallback(() => {
    if ((recordingState !== 'recording' && recordingState !== 'paused') || !focusMode) return;
    chrome.tabs.query({ active: true, currentWindow: true }, ([activeTab]) => {
      if (chrome.runtime.lastError || !activeTab?.id) return;
      setActiveTabCapturable(isCapturableTab(activeTab));
      chrome.runtime.sendMessage({ type: 'GET_TAB_ARMED', tabId: activeTab.id }, (resp) => {
        if (chrome.runtime.lastError) return;
        setActiveTabArmed(Boolean(resp?.armed));
      });
    });
  }, [recordingState, focusMode]);

  useEffect(() => {
    refreshActiveTabArming();
  }, [refreshActiveTabArming]);

  const handleAudioCaptureGranted = useCallback(() => {
    if (recordingState === 'recording' || recordingState === 'paused') {
      chrome.runtime.sendMessage({ type: 'RETRY_ATTACH_APP_AUDIO' }).catch(() => undefined);
    }
  }, [recordingState]);

  // ---- Handlers -----------------------------------------------------------

  const handleArmCurrentTab = () => {
    chrome.runtime.sendMessage({ type: 'ARM_CURRENT_TAB' }, () => {
      setActiveTabArmed(true);
      setTimeout(refreshActiveTabArming, 300);
    });
  };

  const handleStart = async () => {
    setError(null);

    if (focusMode && selectedTabIds.length === 0) {
      setError('Select at least one tab for Focus 1-1 mode.');
      return;
    }

    let startingTabId: number | undefined;
    if (focusMode) {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!activeTab?.id || !isCapturableTab(activeTab)) {
        setError(
          'Open a recordable http/https tab and view it before starting. Focus records the tab you are viewing.'
        );
        return;
      }
      startingTabId = activeTab.id;
    }

    if (needsVirtualAudioCapture(appAudio.nativeHelperStatus === 'connected', focusMode)) {
      const ready = await isAudioCaptureReady();
      if (!ready) {
        setError('Allow audio device access using the button above before recording.');
        return;
      }
    }

    if (includeMic) {
      try {
        const s = await navigator.mediaDevices.getUserMedia({ audio: true });
        s.getTracks().forEach((t) => t.stop());
      } catch (err: any) {
        if (err.name === 'NotAllowedError' || err.message?.includes('Permission denied')) {
          setError('Microphone permission denied. Allow access or turn off "Microphone".');
        } else if (err.name === 'NotFoundError') {
          setError('No microphone found. Connect one or turn off "Microphone".');
        } else {
          setError(`Microphone error: ${err.message || err.toString()}`);
        }
        return;
      }
    }

    if (includeCam) {
      try {
        const s = await navigator.mediaDevices.getUserMedia({ video: true });
        s.getTracks().forEach((t) => t.stop());
      } catch (err: any) {
        if (err.name === 'NotAllowedError' || err.message?.includes('Permission denied')) {
          setError('Camera permission denied. Allow access or turn off "Camera overlay".');
        } else if (err.name === 'NotFoundError') {
          setError('No camera found. Connect one or turn off "Camera overlay".');
        } else {
          setError(`Camera error: ${err.message || err.toString()}`);
        }
        return;
      }
    }

    chrome.runtime.sendMessage(
      {
        type: 'START_RECORDING_FLOW',
        includeMic,
        includeCam,
        focusMode,
        selectedTabIds,
        audioSettings,
        startingTabId,
      },
      () => {
        if (chrome.runtime.lastError) {
          setError(`Failed to start: ${chrome.runtime.lastError.message}`);
        }
      }
    );
  };

  const handleStop = () => {
    chrome.runtime.sendMessage({ type: 'STOP_RECORDING_FLOW' }, () => {
      if (chrome.runtime.lastError) {
        setError(`Failed to stop: ${chrome.runtime.lastError.message}`);
      }
    });
  };

  const handlePause = () => {
    chrome.runtime.sendMessage({ type: 'PAUSE_RECORDING_FLOW' });
  };

  const handleResume = () => {
    chrome.runtime.sendMessage({ type: 'RESUME_RECORDING_FLOW' });
  };

  return (
    <div className="sp-root">
      {/* Header */}
      <header className="sp-header">
        <span className="sp-title">Dzi Recorder</span>
        {(recordingState === 'recording' || recordingState === 'paused') && (
          <span className="sp-header-timer">
            <span className={`sp-dot ${recordingState === 'recording' ? 'sp-dot--pulse' : 'sp-dot--paused'}`} />
            {formatTime(duration)}
          </span>
        )}
      </header>

      {/* Sources */}
      <SourcesSection
        recordingState={recordingState}
        includeMic={includeMic}
        includeCam={includeCam}
        focusMode={focusMode}
        audioSettings={audioSettings}
        onToggleMic={() => setIncludeMic((v) => !v)}
        onToggleCam={() => setIncludeCam((v) => !v)}
        onToggleFocusMode={() => setFocusMode((v) => !v)}
        onAudioSettingsChange={setAudioSettings}
        tabsList={tabsList}
        selectedTabIds={selectedTabIds}
        activeTabId={activeTabId}
        onToggleTabSelection={(id) =>
          setSelectedTabIds((prev) =>
            prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
          )
        }
        onSelectAllTabs={() => setTabsList((t) => (setSelectedTabIds(t.map((x) => x.id!)), t))}
        onClearTabSelection={() => setSelectedTabIds([])}
      />

      {/* Recording controls */}
      <RecordingControls
        recordingState={recordingState}
        duration={duration}
        error={error}
        showArmCurrentTab={focusMode && activeTabCapturable && !activeTabArmed}
        onStart={handleStart}
        onStop={handleStop}
        onPause={handlePause}
        onResume={handleResume}
        onArmCurrentTab={handleArmCurrentTab}
        onDismissError={() => setError(null)}
      />

      <AudioCapturePermission
        nativeHelperStatus={appAudio.nativeHelperStatus}
        focusMode={focusMode}
        recordingState={recordingState}
        onGranted={handleAudioCaptureGranted}
      />

      {/* Native audio helper */}
      <AudioHelperSection appAudio={appAudio} />

      {/* Logs */}
      <LogsSection lines={logLines} />
    </div>
  );
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
