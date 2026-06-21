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
import { ChunkStorage } from '../../utils/chunkStorage';
import { fixWebmDuration } from '../../utils/webmDurationFix';
import { AlertOctagon, Download, Trash2, Loader, AlertTriangle, AlertCircle, RefreshCw, Settings, ChevronDown, Mic, Camera } from 'lucide-react';
import { formatTime } from '../../utils/format';

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

  // ---- Session Recovery State ----
  const [recovering, setRecovering] = useState(false);
  const [interruptedSession, setInterruptedSession] = useState<any>(null);
  const [chunkCount, setChunkCount] = useState<number>(0);

  // ---- Source Lost alert states ----
  const [sourceLostAlert, setSourceLostAlert] = useState(false);
  const [openTabs, setOpenTabs] = useState<chrome.tabs.Tab[]>([]);
  const [selectedFallbackTab, setSelectedFallbackTab] = useState<string>('');
  const [switchingSource, setSwitchingSource] = useState(false);

  // ---- Audio Alert State ----
  const [audioSilentAlert, setAudioSilentAlert] = useState(false);
  const [advancedExpanded, setAdvancedExpanded] = useState(false);

  // ---- Permission States for Onboarding Setup ----
  const [micPermissionState, setMicPermissionState] = useState<'prompt' | 'granted' | 'denied'>('prompt');
  const [camPermissionState, setCamPermissionState] = useState<'prompt' | 'granted' | 'denied'>('prompt');

  // Query permissions on mount
  useEffect(() => {
    if (typeof navigator.permissions?.query === 'function') {
      navigator.permissions.query({ name: 'microphone' as PermissionName }).then((status) => {
        setMicPermissionState(status.state as any);
        status.onchange = () => setMicPermissionState(status.state as any);
      }).catch(() => undefined);

      navigator.permissions.query({ name: 'camera' as PermissionName }).then((status) => {
        setCamPermissionState(status.state as any);
        status.onchange = () => setCamPermissionState(status.state as any);
      }).catch(() => undefined);
    }
  }, []);

  const openPermissionTab = (audio: boolean, video: boolean) => {
    const url = chrome.runtime.getURL(`permission.html?audio=${audio}&video=${video}`);
    chrome.tabs.create({ url });
  };

  const requestAudioPermission = async () => {
    openPermissionTab(true, false);
  };

  const requestVideoPermission = async () => {
    openPermissionTab(false, true);
  };

  const requestAllPermissions = async () => {
    openPermissionTab(includeMic, includeCam);
  };

  const recheckPermissions = async () => {
    if (typeof navigator.permissions?.query === 'function') {
      try {
        const mic = await navigator.permissions.query({ name: 'microphone' as PermissionName });
        setMicPermissionState(mic.state as any);
        const cam = await navigator.permissions.query({ name: 'camera' as PermissionName });
        setCamPermissionState(cam.state as any);
      } catch (err) {
        await checkPermissionsMedia();
      }
    } else {
      await checkPermissionsMedia();
    }
  };

  const checkPermissionsMedia = async () => {
    if (includeMic) {
      try {
        const s = await navigator.mediaDevices.getUserMedia({ audio: true });
        s.getTracks().forEach((t) => t.stop());
        setMicPermissionState('granted');
      } catch (err: any) {
        if (err.name === 'NotAllowedError' || err.message?.includes('Permission denied')) {
          setMicPermissionState('denied');
        } else {
          setMicPermissionState('prompt');
        }
      }
    }
    if (includeCam) {
      try {
        const s = await navigator.mediaDevices.getUserMedia({ video: true });
        s.getTracks().forEach((t) => t.stop());
        setCamPermissionState('granted');
      } catch (err: any) {
        if (err.name === 'NotAllowedError' || err.message?.includes('Permission denied')) {
          setCamPermissionState('denied');
        } else {
          setCamPermissionState('prompt');
        }
      }
    }
  };

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
      if (state.recordingState === 'idle') {
        setAudioSilentAlert(false);
      }
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
      if (message.type === 'RECORDED_TAB_CLOSED') {
        setSourceLostAlert(true);
      }
      if (message.type === 'STREAM_HEALTH_EVENT' && message.event === 'VIDEO_SOURCE_LOST') {
        setSourceLostAlert(true);
      }
      if (message.type === 'AUDIO_HEALTH_EVENT') {
        if (message.event === 'AUDIO_SILENT' || message.event === 'AUDIO_SOURCE_LOST') {
          setAudioSilentAlert(true);
        } else if (message.event === 'AUDIO_ACTIVE') {
          setAudioSilentAlert(false);
        }
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

  useEffect(() => {
    if (recordingState === 'interrupted') {
      chrome.storage.local.get(['activeSession'], (result: any) => {
        if (result.activeSession) {
          const activeSession = result.activeSession;
          setInterruptedSession(activeSession);
          const storage = new ChunkStorage();
          storage.initExisting(activeSession.sessionId).then(() => {
            setChunkCount(storage.getChunkCount());
          }).catch((err) => {
            console.error('[sidepanel] Failed to load chunk count for recovery:', err);
          });
        }
      });
    } else {
      setInterruptedSession(null);
      setChunkCount(0);
    }
  }, [recordingState]);

  useEffect(() => {
    if (sourceLostAlert) {
      chrome.tabs.query({ windowType: 'normal' }, (tabs) => {
        if (chrome.runtime.lastError || !tabs) return;
        const filtered = tabs.filter(isCapturableTab);
        setOpenTabs(filtered);
        if (filtered.length > 0) {
          setSelectedFallbackTab(String(filtered[0].id));
        }
      });
    }
  }, [sourceLostAlert]);

  const handleAudioSettingsChange = (settings: AudioMixSettings) => {
    setAudioSettings(settings);
    if (recordingState === 'recording' || recordingState === 'paused') {
      chrome.runtime.sendMessage({
        type: 'UPDATE_AUDIO_SETTINGS',
        audioSettings: settings,
      }).catch(() => undefined);
    }
  };

  const handleResumeSession = async () => {
    if (!interruptedSession) return;
    setRecovering(true);
    try {
      chrome.runtime.sendMessage({ type: 'RESUME_INTERRUPTED_SESSION' }, (response) => {
        if (chrome.runtime.lastError || !response?.success) {
          alert(`Failed to resume session: ${chrome.runtime.lastError?.message || response?.error || 'unknown error'}`);
        }
      });
    } catch (err: any) {
      alert(`Resume failed: ${err.message || err.toString()}`);
    } finally {
      setRecovering(false);
    }
  };

  const handleRecover = async () => {
    if (!interruptedSession) return;
    setRecovering(true);
    try {
      const storage = new ChunkStorage();
      await storage.initExisting(interruptedSession.sessionId);
      
      const mimeType = interruptedSession.mimeType || 'video/webm';
      let blob = await storage.assembleBlob(mimeType);
      
      if (blob.size > 0) {
        // Derive duration dynamically from chunkCount (since chunks are written every 1000ms)
        const derivedDurationMs = chunkCount * 1000;
        blob = await fixWebmDuration(blob, derivedDurationMs);
        
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const pad = (n: number) => String(n).padStart(2, '0');
        const now = new Date(interruptedSession.startTime || Date.now());
        const timestamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
        a.download = `recovered-recording-${timestamp}.webm`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        await storage.cleanup();
        chrome.runtime.sendMessage({ type: 'RECOVERED_SESSION_SAVED' });
      } else {
        alert('Could not recover any chunks for this session. It might be empty.');
        await storage.cleanup();
        chrome.runtime.sendMessage({ type: 'DISCARD_INTERRUPTED_SESSION' });
      }
    } catch (err: any) {
      console.error('[sidepanel] Recovery failed:', err);
      alert(`Recovery failed: ${err.message || err.toString()}`);
    } finally {
      setRecovering(false);
    }
  };

  const handleDiscard = async () => {
    if (!interruptedSession) return;
    if (!confirm('Are you sure you want to discard this interrupted recording? It cannot be recovered.')) {
      return;
    }
    setRecovering(true);
    try {
      const storage = new ChunkStorage();
      await storage.initExisting(interruptedSession.sessionId);
      await storage.cleanup();
      chrome.runtime.sendMessage({ type: 'DISCARD_INTERRUPTED_SESSION' });
    } catch (err: any) {
      console.error('[sidepanel] Discard failed:', err);
      alert(`Discard failed: ${err.message || err.toString()}`);
    } finally {
      setRecovering(false);
    }
  };

  const handleFallbackStop = () => {
    setSourceLostAlert(false);
    handleStop();
  };

  const handleFallbackSwitchTab = () => {
    if (!selectedFallbackTab) return;
    setSwitchingSource(true);
    const tabId = Number(selectedFallbackTab);
    chrome.runtime.sendMessage({ type: 'ARM_CURRENT_TAB', tabId }, (resp) => {
      setSwitchingSource(false);
      if (resp?.success) {
        setSourceLostAlert(false);
      } else {
        alert(`Failed to switch: ${resp?.error || 'unknown error'}`);
      }
    });
  };

  const handleFallbackSwitchDisplayMedia = () => {
    setSwitchingSource(true);
    chrome.runtime.sendMessage({ type: 'FALLBACK_TO_DISPLAY_MEDIA' }, (resp) => {
      setSwitchingSource(false);
      if (resp?.success) {
        setSourceLostAlert(false);
      }
    });
  };

  const handleKeepRecordingAudio = () => {
    setSourceLostAlert(false);
  };

  const handleArmCurrentTab = () => {
    chrome.runtime.sendMessage({ type: 'ARM_CURRENT_TAB' }, () => {
      setActiveTabArmed(true);
      setTimeout(refreshActiveTabArming, 300);
    });
  };

  const handleToggleMic = () => {
    const next = !includeMic;
    setIncludeMic(next);
    if (next && micPermissionState !== 'granted') {
      openPermissionTab(true, includeCam);
    }
  };

  const handleToggleCam = () => {
    const next = !includeCam;
    setIncludeCam(next);
    if (next && camPermissionState !== 'granted') {
      openPermissionTab(includeMic, true);
    }
  };

  const handleStart = async () => {
    setError(null);

    // If permissions are not granted, open the permission tab and stop
    const needMic = includeMic && micPermissionState !== 'granted';
    const needCam = includeCam && camPermissionState !== 'granted';
    if (needMic || needCam) {
      openPermissionTab(includeMic, includeCam);
      return;
    }

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

  const showOnboarding = recordingState === 'idle' && (
    (includeMic && micPermissionState !== 'granted') ||
    (includeCam && camPermissionState !== 'granted')
  );

  return (
    <div className="sp-root">
      {/* Header */}
      <header className="sp-header">
        <span className="sp-title">
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)' }} />
          EXT Recorder
        </span>
        {(recordingState === 'recording' || recordingState === 'paused') && (
          <span className="sp-header-timer">
            <span className={`sp-dot ${recordingState === 'recording' ? 'sp-dot--pulse' : 'sp-dot--paused'}`} />
            {formatTime(duration)}
          </span>
        )}
      </header>

      {audioSilentAlert && (recordingState === 'recording' || recordingState === 'paused') && (
        <div className="sp-audio-alert sp-alert--pulse">
          <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: '2px' }} />
          <span>Warning: No audio signal detected from microphone. Check your connection.</span>
        </div>
      )}

      {/* Permission alert placed high up for maximum discoverability */}
      {recordingState === 'idle' && !showOnboarding && (
        <AudioCapturePermission
          nativeHelperStatus={appAudio.nativeHelperStatus}
          focusMode={focusMode}
          recordingState={recordingState}
          onGranted={handleAudioCaptureGranted}
        />
      )}

      {/* Content Area */}
      {showOnboarding ? (
        <div className="permission-screen">
          <div className="permission-illustration">
            <span className="permission-pulse-circle">
              <AlertOctagon size={32} className="permission-icon-glow" style={{ color: (includeMic && micPermissionState === 'denied') || (includeCam && camPermissionState === 'denied') ? 'var(--color-danger)' : 'var(--color-accent)' }} />
            </span>
          </div>

          <h2 className="permission-title">
            {(includeMic && micPermissionState === 'denied') || (includeCam && camPermissionState === 'denied') ? 'Access Blocked' : 'Enable Device Access'}
          </h2>
          <p className="permission-desc">
            {(includeMic && micPermissionState === 'denied') || (includeCam && camPermissionState === 'denied')
              ? 'Chrome has blocked access to your microphone or camera. Please allow device access in site settings to proceed.'
              : 'To record meetings along with your voice or camera overlay, please grant microphone and camera permissions.'}
          </p>

          <div className="permission-cards-list">
            {includeMic && (
              <div className={`permission-item-card ${micPermissionState === 'granted' ? 'granted' : micPermissionState === 'denied' ? 'denied' : ''}`}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <Mic size={18} className="permission-card-item-icon" />
                  <div style={{ textAlign: 'left' }}>
                    <div style={{ fontWeight: 600, fontSize: '12px' }}>Microphone Access</div>
                    <div style={{ fontSize: '10.5px', color: 'var(--text-secondary)' }}>
                      {micPermissionState === 'granted' ? 'Granted successfully' : micPermissionState === 'denied' ? 'Blocked by browser' : 'Required for audio'}
                    </div>
                  </div>
                </div>
                {micPermissionState === 'prompt' && (
                  <button className="sp-btn sp-btn--primary sp-btn--sm" onClick={requestAudioPermission}>
                    Allow
                  </button>
                )}
              </div>
            )}

            {includeCam && (
              <div className={`permission-item-card ${camPermissionState === 'granted' ? 'granted' : camPermissionState === 'denied' ? 'denied' : ''}`}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <Camera size={18} className="permission-card-item-icon" />
                  <div style={{ textAlign: 'left' }}>
                    <div style={{ fontWeight: 600, fontSize: '12px' }}>Camera Access</div>
                    <div style={{ fontSize: '10.5px', color: 'var(--text-secondary)' }}>
                      {camPermissionState === 'granted' ? 'Granted successfully' : camPermissionState === 'denied' ? 'Blocked by browser' : 'Required for video'}
                    </div>
                  </div>
                </div>
                {camPermissionState === 'prompt' && (
                  <button className="sp-btn sp-btn--primary sp-btn--sm" onClick={requestVideoPermission}>
                    Allow
                  </button>
                )}
              </div>
            )}
          </div>

          {((includeMic && micPermissionState === 'denied') || (includeCam && camPermissionState === 'denied')) ? (
            <div className="permission-instruction-box">
              <div style={{ fontWeight: 600, marginBottom: 4 }}>How to Unblock:</div>
              <ol style={{ paddingLeft: 16, fontSize: '11px', textAlign: 'left', lineHeight: 1.45 }}>
                <li>Click the camera icon 📹 or site settings icon in your browser URL bar.</li>
                <li>Change Microphone/Camera block to <strong>"Allow"</strong>.</li>
                <li>Click the <strong>Re-check Permissions</strong> button below.</li>
              </ol>
            </div>
          ) : (
            <button className="sp-btn sp-btn--primary" onClick={requestAllPermissions} style={{ width: '100%', justifyContent: 'center', padding: '10px 16px' }}>
              Request Access
            </button>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%', marginTop: 8 }}>
            {((includeMic && micPermissionState === 'denied') || (includeCam && camPermissionState === 'denied')) && (
              <button className="sp-btn sp-btn--primary" onClick={recheckPermissions} style={{ justifyContent: 'center' }}>
                Re-check Permissions
              </button>
            )}
            
            <button
              className="sp-btn sp-btn--secondary"
              onClick={() => {
                setIncludeMic(false);
                setIncludeCam(false);
              }}
              style={{ justifyContent: 'center' }}
            >
              Skip & Record Screen Only
            </button>
          </div>
        </div>
      ) : recordingState === 'interrupted' ? (
        <section className="sp-recovery-card">
          <div className="sp-recovery-title">
            <AlertOctagon size={16} style={{ color: 'var(--color-danger)' }} />
            Interrupted Session Detected
          </div>
          <p className="sp-recovery-meta">
            A recording session from <strong>{interruptedSession ? new Date(interruptedSession.startTime).toLocaleTimeString() : 'earlier'}</strong> was interrupted due to a browser crash or reload.
            <br />
            Approximate duration: <strong>{formatTime(chunkCount)}</strong>.
            <br />
            Saved chunks: <strong>{chunkCount}</strong>.
          </p>
          <div className="sp-actions-row" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <button 
              className="sp-btn sp-btn--primary" 
              onClick={handleResumeSession} 
              disabled={recovering}
              style={{ width: '100%', justifyContent: 'center' }}
            >
              <RefreshCw size={14} />
              Continue Recording
            </button>
            <div style={{ display: 'flex', gap: 8, width: '100%' }}>
              <button 
                className="sp-btn sp-btn--secondary" 
                onClick={handleRecover} 
                disabled={recovering}
                style={{ flex: 1, justifyContent: 'center' }}
              >
                {recovering ? (
                  <>
                    <Loader size={14} className="sp-dot--pulse" />
                    Exporting…
                  </>
                ) : (
                  <>
                    <Download size={14} />
                    Export Partial Video
                  </>
                )}
              </button>
              <button 
                className="sp-btn sp-btn--secondary" 
                onClick={handleDiscard} 
                disabled={recovering}
                style={{ flex: 1, justifyContent: 'center', borderColor: 'rgba(239, 68, 68, 0.4)', color: 'var(--color-danger)' }}
              >
                <Trash2 size={14} />
                Discard
              </button>
            </div>
          </div>
        </section>
      ) : (
        <>
          {/* Sources */}
          <SourcesSection
            recordingState={recordingState}
            includeMic={includeMic}
            includeCam={includeCam}
            focusMode={focusMode}
            audioSettings={audioSettings}
            onToggleMic={handleToggleMic}
            onToggleCam={handleToggleCam}
            onToggleFocusMode={() => setFocusMode((v) => !v)}
            onAudioSettingsChange={handleAudioSettingsChange}
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
        </>
      )}

      {/* Source Lost Alert Modal */}
      {sourceLostAlert && (
        <div className="sp-modal-overlay">
          <div className="sp-modal">
            <div className="sp-modal-title">
              <AlertTriangle size={16} />
              Recording Source Lost
            </div>
            <p className="sp-modal-text">
              The tab or screen source currently being recorded was closed or is no longer available. How would you like to continue?
            </p>
            <div className="sp-modal-actions">
              <button className="sp-btn sp-btn--stop" onClick={handleFallbackStop} disabled={switchingSource}>
                Stop & Save Recording
              </button>
              
              {openTabs.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span style={{ fontSize: '10px', color: 'var(--text-secondary)', fontWeight: 600 }}>SWITCH TO ANOTHER TAB</span>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <select 
                      className="sp-select"
                      value={selectedFallbackTab} 
                      onChange={(e) => setSelectedFallbackTab(e.target.value)}
                      disabled={switchingSource}
                    >
                      {openTabs.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.title || `Tab ${t.id}`}
                        </option>
                      ))}
                    </select>
                    <button className="sp-btn sp-btn--primary sp-btn--sm" onClick={handleFallbackSwitchTab} disabled={switchingSource}>
                      Switch
                    </button>
                  </div>
                </div>
              )}

              <button className="sp-btn sp-btn--secondary" onClick={handleFallbackSwitchDisplayMedia} disabled={switchingSource}>
                Choose Screen / Window...
              </button>

              <button className="sp-btn sp-btn--secondary" onClick={handleKeepRecordingAudio} disabled={switchingSource}>
                Keep Audio Only (shows placeholder)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Advanced Settings fold shown only in idle to declutter recording view */}
      {recordingState === 'idle' && (
        <div className="accordion">
          <button
            className="accordion-header"
            onClick={() => setAdvancedExpanded(!advancedExpanded)}
            aria-expanded={advancedExpanded}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Settings size={14} />
              Advanced Settings
            </span>
            <ChevronDown
              size={14}
              className={`accordion-icon ${advancedExpanded ? 'expanded' : ''}`}
            />
          </button>
          {advancedExpanded && (
            <div className="accordion-content">
              {/* Native audio helper */}
              <AudioHelperSection appAudio={appAudio} />

              {/* Logs */}
              <LogsSection lines={logLines} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}


