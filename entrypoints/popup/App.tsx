import { useState, useEffect, useCallback } from 'react';
import { MicLevelMeter } from '../../components/MicLevelMeter';
import { RecorderControls } from '../../components/RecorderControls';
import {
  DEFAULT_AUDIO_SETTINGS,
  type AudioMixSettings,
  type RecordingState,
} from '../../utils/types';

const CAPTURABLE_URL_PREFIXES = ['http://', 'https://'];

function isCapturableTab(tab: chrome.tabs.Tab): boolean {
  if (!tab.id || tab.id <= 0 || !tab.url) {
    return false;
  }
  return CAPTURABLE_URL_PREFIXES.some((prefix) => tab.url!.startsWith(prefix));
}

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
  const [activeTabId, setActiveTabId] = useState<number | null>(null);

  const [tabsList, setTabsList] = useState<chrome.tabs.Tab[]>([]);
  const [selectedTabIds, setSelectedTabIds] = useState<number[]>([]);
  const [activeTabArmed, setActiveTabArmed] = useState<boolean>(true);
  const [activeTabCapturable, setActiveTabCapturable] = useState<boolean>(false);

  const syncFromBackground = useCallback((state: {
    recordingState: RecordingState;
    duration: number;
    error: string | null;
    includeMic: boolean;
    includeCam: boolean;
    focusMode: boolean;
    audioSettings: AudioMixSettings;
  }) => {
    setRecordingState(state.recordingState);
    setDuration(state.duration);
    setError(state.error);
    setIncludeMic(state.includeMic);
    setIncludeCam(state.includeCam);
    setFocusMode(state.focusMode ?? false);
    setAudioSettings(state.audioSettings ?? { ...DEFAULT_AUDIO_SETTINGS });
  }, []);

  useEffect(() => {
    chrome.runtime.sendMessage({ type: 'GET_RECORDING_STATUS' }, (response) => {
      if (chrome.runtime.lastError) {
        console.error('Failed to get recording status:', chrome.runtime.lastError);
        return;
      }
      if (response) {
        syncFromBackground(response);
      }
    });

    const handleMessage = (message: any) => {
      if (message.type === 'STATE_CHANGED' && message.state) {
        syncFromBackground(message.state);
      }
    };

    chrome.runtime.onMessage.addListener(handleMessage);
    return () => {
      chrome.runtime.onMessage.removeListener(handleMessage);
    };
  }, [syncFromBackground]);

  useEffect(() => {
    if (!focusMode || recordingState !== 'idle') {
      return;
    }

    chrome.tabs.query({ windowType: 'normal' }, (tabs) => {
      if (chrome.runtime.lastError) {
        return;
      }

      const filteredTabs = tabs.filter(isCapturableTab);
      setTabsList(filteredTabs);

      chrome.tabs.query({ active: true, currentWindow: true }, (activeTabs) => {
        const activeTab = activeTabs[0];
        if (activeTab?.id) {
          setActiveTabId(activeTab.id);
          setSelectedTabIds((prev) => {
            if (prev.length === 0 && isCapturableTab(activeTab)) {
              return [activeTab.id!];
            }
            return prev;
          });
        }
      });
    });
  }, [focusMode, recordingState]);

  // While a Focus recording is running, check whether the tab the user is
  // currently viewing has been armed. Opening this popup is a browser-action
  // invocation, so it grants the capture grant for the active tab — meaning the
  // "Record this tab" button below can arm it with a single click.
  const refreshActiveTabArming = useCallback(() => {
    if ((recordingState !== 'recording' && recordingState !== 'paused') || !focusMode) {
      return;
    }
    chrome.tabs.query({ active: true, currentWindow: true }, ([activeTab]) => {
      if (chrome.runtime.lastError || !activeTab?.id) {
        return;
      }
      setActiveTabCapturable(isCapturableTab(activeTab));
      chrome.runtime.sendMessage({ type: 'GET_TAB_ARMED', tabId: activeTab.id }, (resp) => {
        if (chrome.runtime.lastError) {
          return;
        }
        setActiveTabArmed(Boolean(resp?.armed));
      });
    });
  }, [recordingState, focusMode]);

  useEffect(() => {
    refreshActiveTabArming();
  }, [refreshActiveTabArming]);

  const handleArmCurrentTab = () => {
    chrome.runtime.sendMessage({ type: 'ARM_CURRENT_TAB' }, () => {
      setActiveTabArmed(true);
      setTimeout(refreshActiveTabArming, 300);
    });
  };

  const handleToggleTabSelection = (tabId: number) => {
    setSelectedTabIds((prev) =>
      prev.includes(tabId) ? prev.filter((id) => id !== tabId) : [...prev, tabId]
    );
  };

  const handleSelectAllTabs = () => {
    setSelectedTabIds(tabsList.map((tab) => tab.id!).filter(Boolean));
  };

  const handleClearTabSelection = () => {
    setSelectedTabIds([]);
  };

  const handleStartRecording = async () => {
    setError(null);

    if (focusMode && selectedTabIds.length === 0) {
      setError('Select at least one tab for Focus 1-1 mode.');
      return;
    }

    let startingTabId: number | undefined;

    if (focusMode) {
      // Opening this popup grants the extension an activeTab capture grant for
      // the CURRENT tab only. Chrome will not let us capture any other tab until
      // the user invokes the extension on it (the Alt+Shift+F shortcut or the
      // right-click "Add this tab to Focus recording" menu), so all we require
      // here is that the tab being viewed is recordable.
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });

      if (!activeTab?.id || !isCapturableTab(activeTab)) {
        setError(
          'Open a recordable http/https tab and view it before starting. Focus records the tab you are viewing.'
        );
        return;
      }

      startingTabId = activeTab.id;
    }

    if (includeMic) {
      try {
        const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        micStream.getTracks().forEach((track) => track.stop());
      } catch (err: any) {
        if (err.name === 'NotAllowedError' || err.message?.includes('Permission denied')) {
          setError('Microphone permission denied. Allow access or turn off "Microphone".');
        } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
          setError('No microphone found. Connect one or turn off "Microphone".');
        } else {
          setError(`Microphone error: ${err.message || err.toString()}`);
        }
        return;
      }
    }

    if (includeCam) {
      try {
        const camStream = await navigator.mediaDevices.getUserMedia({ video: true });
        camStream.getTracks().forEach((track) => track.stop());
      } catch (err: any) {
        if (err.name === 'NotAllowedError' || err.message?.includes('Permission denied')) {
          setError('Camera permission denied. Allow access or turn off "Camera overlay".');
        } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
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
      showArmCurrentTab={focusMode && activeTabCapturable && !activeTabArmed}
      onArmCurrentTab={handleArmCurrentTab}
      error={error}
      onDismissError={() => setError(null)}
      tabsList={tabsList}
      selectedTabIds={selectedTabIds}
      activeTabId={activeTabId}
      onToggleTabSelection={handleToggleTabSelection}
      onSelectAllTabs={handleSelectAllTabs}
      onClearTabSelection={handleClearTabSelection}
      micMeter={<MicLevelMeter enabled={includeMic && recordingState === 'idle'} />}
    />
  );
}

export default App;
