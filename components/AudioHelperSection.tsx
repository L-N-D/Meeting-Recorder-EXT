import { useCallback, useEffect, useState } from 'react';
import type { AppAudioState, AudioSession } from '../utils/types';
import type { AudioApplication } from '../utils/nativeAudio';

interface AudioHelperSectionProps {
  appAudio: AppAudioState;
}

type StatusColor = 'green' | 'yellow' | 'red' | 'gray';

function helperStatusColor(appAudio: AppAudioState): StatusColor {
  switch (appAudio.nativeHelperStatus) {
    case 'connected': return 'green';
    case 'error': return 'red';
    case 'not_installed': return 'red';
    default: return 'gray';
  }
}

function helperStatusLabel(appAudio: AppAudioState): string {
  switch (appAudio.nativeHelperStatus) {
    case 'connected': return 'Connected';
    case 'not_installed': return 'Not installed';
    case 'error': return 'Error';
    default: return 'Unknown';
  }
}

function sessionStatusLabel(appAudio: AppAudioState): string {
  switch (appAudio.sessionStatus) {
    case 'preparing': return 'Preparing virtual device…';
    case 'virtual_device_ready': return 'Virtual device ready';
    case 'mirroring': return `Mirroring ${appAudio.mirrors.length} app(s)`;
    case 'error': return `Error: ${appAudio.error ?? 'unknown'}`;
    default: return 'Idle';
  }
}

export function AudioHelperSection({ appAudio }: AudioHelperSectionProps) {
  const [apps, setApps] = useState<AudioApplication[]>([]);
  const [selectedPid, setSelectedPid] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [diagnosis, setDiagnosis] = useState<string | null>(null);

  const diagnoseCapture = useCallback(() => {
    setLocalError(null);
    setDiagnosis(null);
    setBusy(true);
    chrome.runtime.sendMessage({ type: 'NATIVE_DIAGNOSE_CAPTURE' }, (resp) => {
      setBusy(false);
      if (chrome.runtime.lastError) {
        setLocalError(chrome.runtime.lastError.message ?? 'Diagnose failed');
        return;
      }
      if (resp?.success && resp.diagnosis?.comparisonTable) {
        const lines = resp.diagnosis.comparisonTable.map(
          (r: { pulseName: string; index: number; isMonitor: boolean; chromeVisible: boolean }) =>
            `${r.pulseName} → Chrome ${r.chromeVisible ? 'visible' : 'hidden'}${r.isMonitor ? ' (monitor)' : ''}`
        );
        setDiagnosis(lines.join('\n') || 'No virtual sources in pactl');
      } else {
        setLocalError(resp?.error ?? 'Diagnose failed');
      }
    });
  }, []);

  const refreshApps = useCallback(() => {
    setLocalError(null);
    setBusy(true);
    chrome.runtime.sendMessage({ type: 'NATIVE_LIST_APPS' }, (resp) => {
      setBusy(false);
      if (chrome.runtime.lastError) {
        setLocalError(`Not reachable: ${chrome.runtime.lastError.message}`);
        return;
      }
      if (resp?.success) {
        const list: AudioApplication[] = (resp.apps ?? []).filter(
          (a: AudioApplication) => a.pid != null
        );
        setApps(list);
        if (list.length && selectedPid == null) setSelectedPid(list[0].pid);
        if (!list.length) setLocalError('No applications are currently playing audio.');
      } else {
        setLocalError(resp?.error ?? 'Failed to list applications');
      }
    });
  }, [selectedPid]);

  const pingHost = useCallback(() => {
    setBusy(true);
    setLocalError(null);
    chrome.runtime.sendMessage({ type: 'NATIVE_PING' }, (resp) => {
      setBusy(false);
      if (chrome.runtime.lastError) {
        setLocalError(chrome.runtime.lastError.message ?? 'Connection failed');
      }
    });
  }, []);

  const handleMirror = useCallback(() => {
    if (selectedPid == null) {
      setLocalError('Pick an application first.');
      return;
    }
    setLocalError(null);
    setBusy(true);
    const app = apps.find((a) => a.pid === selectedPid);
    chrome.runtime.sendMessage(
      { type: 'MIRROR_APP_AUDIO', pid: selectedPid, appName: app?.name },
      (resp) => {
        setBusy(false);
        if (chrome.runtime.lastError) {
          setLocalError(chrome.runtime.lastError.message ?? 'Failed to mirror');
          return;
        }
        if (!resp?.success) setLocalError(resp?.error ?? 'Failed to mirror application');
      }
    );
  }, [selectedPid, apps]);

  const handleStopMirror = useCallback((pid: number) => {
    chrome.runtime.sendMessage({ type: 'STOP_MIRROR_APP', pid }, () => undefined);
  }, []);

  const isNotInstalled = appAudio.nativeHelperStatus === 'not_installed';
  const isConnected = appAudio.nativeHelperStatus === 'connected';
  const statusColor = helperStatusColor(appAudio);

  return (
    <section className="sp-section">
      <div className="sp-section-header">
        <div className="sp-section-title">Audio Helper</div>
        <span className={`sp-status-badge sp-status-badge--${statusColor}`}>
          {helperStatusLabel(appAudio)}
        </span>
      </div>

      {isNotInstalled && (
        <div className="sp-alert sp-alert--warn">
          <strong>Native Audio Helper not installed.</strong>
          <ol style={{ margin: '4px 0 0', paddingLeft: 16, fontSize: '0.85em' }}>
            <li>Open a terminal in the extension folder</li>
            <li>Run: <code>bash native-helper/install.sh</code></li>
            <li>Reload Chrome, then click Re-check below</li>
          </ol>
        </div>
      )}

      {appAudio.nativeHelperStatus === 'error' && appAudio.error && (
        <div className="sp-alert sp-alert--error">{appAudio.error}</div>
      )}

      {isConnected && appAudio.sessionStatus === 'idle' && (
        <div className="sp-alert sp-alert--info sp-alert--sm">
          Virtual device is created after you pick <strong>Application Window</strong> or{' '}
          <strong>Entire Screen</strong> in the share picker (not Chrome Tab).
        </div>
      )}

      {appAudio.sessionStatus === 'error' && appAudio.error && (
        <div className="sp-alert sp-alert--error sp-alert--sm">{appAudio.error}</div>
      )}

      {/* Session status */}
      {appAudio.sessionStatus !== 'idle' && (
        <div className={`sp-session-status sp-session-status--${appAudio.sessionStatus}`}>
          {sessionStatusLabel(appAudio)}
        </div>
      )}

      {/* Device label */}
      {appAudio.deviceLabelHint && (
        <div className="sp-device-label">
          <span className="sp-label-muted">Device:</span> {appAudio.deviceLabelHint}
        </div>
      )}

      {/* Active mirrors */}
      {appAudio.mirrors.length > 0 && (
        <div className="sp-mirrors">
          {appAudio.mirrors.map((m: AudioSession) => (
            <div key={m.pid} className="sp-mirror-row">
              <span className="sp-mirror-name">
                <span className="sp-dot sp-dot--pulse sp-dot--sm" />
                {m.name} <span className="sp-label-muted">(pid {m.pid})</span>
              </span>
              <button
                className="sp-btn-xs sp-btn-xs--danger"
                onClick={() => handleStopMirror(m.pid)}
              >
                Stop
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Controls — app list + mirror shown only when connected */}
      {isConnected && (
        <div className="sp-audio-controls">
          <div className="sp-audio-controls-row">
            <select
              className="sp-select"
              value={selectedPid ?? ''}
              onChange={(e) =>
                setSelectedPid(e.target.value ? Number(e.target.value) : null)
              }
              disabled={apps.length === 0 || busy}
            >
              {apps.length === 0 && (
                <option value="">— no apps found —</option>
              )}
              {apps.map((a) => (
                <option key={`${a.nodeId}`} value={a.pid ?? ''}>
                  {a.name} (pid {a.pid})
                </option>
              ))}
            </select>
            <button
              className="sp-btn sp-btn--secondary sp-btn--sm"
              onClick={refreshApps}
              disabled={busy}
              title="Refresh app list"
            >
              ↻
            </button>
          </div>

          <div className="sp-audio-controls-row">
            <button
              className="sp-btn sp-btn--primary sp-btn--sm"
              onClick={handleMirror}
              disabled={busy || selectedPid == null}
            >
              Mirror audio
            </button>
          </div>
        </div>
      )}

      {/* Re-check always visible so the user can retry after any failure */}
      <div className="sp-audio-controls-row" style={{ marginTop: 6 }}>
        <button
          className="sp-btn sp-btn--secondary sp-btn--sm"
          onClick={pingHost}
          disabled={busy}
        >
          Re-check
        </button>
        {isConnected && (
          <button
            className="sp-btn sp-btn--secondary sp-btn--sm"
            onClick={diagnoseCapture}
            disabled={busy}
            title="Compare pactl sources vs Chrome visibility"
          >
            Diagnose audio
          </button>
        )}
      </div>

      {diagnosis && (
        <pre className="sp-alert sp-alert--info sp-alert--sm" style={{ fontSize: '0.75em', whiteSpace: 'pre-wrap' }}>
          {diagnosis}
        </pre>
      )}

      {localError && (
        <div className="sp-alert sp-alert--error sp-alert--sm">{localError}</div>
      )}
    </section>
  );
}
