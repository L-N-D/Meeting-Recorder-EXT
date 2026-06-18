import { useCallback, useEffect, useState } from 'react';
import type { NativeHelperStatus, RecordingState } from '../utils/types';
import {
  probeAudioCapturePermission,
  requestAudioCapturePermission,
  needsVirtualAudioCapture,
  isAudioCaptureReady,
  markAudioCaptureGranted,
  extensionMicSettingsOrigin,
  extensionMicSettingsUrl,
  type AudioCapturePermState,
} from '../utils/audioCapturePermission';

interface AudioCapturePermissionProps {
  nativeHelperStatus: NativeHelperStatus;
  focusMode: boolean;
  recordingState: RecordingState;
  /** Called after permission is granted — parent can retry virtual device attach. */
  onGranted?: () => void;
}

export function AudioCapturePermission({
  nativeHelperStatus,
  focusMode,
  recordingState,
  onGranted,
}: AudioCapturePermissionProps) {
  const [permState, setPermState] = useState<AudioCapturePermState | null>(null);
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const show =
    needsVirtualAudioCapture(nativeHelperStatus === 'connected', focusMode) &&
    permState !== 'granted';

  const refresh = useCallback(async () => {
    if (!needsVirtualAudioCapture(nativeHelperStatus === 'connected', focusMode)) {
      setPermState(null);
      return;
    }
    if (await isAudioCaptureReady()) {
      setPermState('granted');
      return;
    }
    const state = await probeAudioCapturePermission();
    setPermState(state);
  }, [nativeHelperStatus, focusMode]);

  useEffect(() => {
    void refresh();
  }, [refresh, recordingState]);

  const handleGrant = async () => {
    setBusy(true);
    setLocalError(null);
    try {
      // Re-check: probe first (picks up settings-page Allow without needing hardware mic).
      const probed = await probeAudioCapturePermission();
      if (probed === 'granted') {
        setPermState('granted');
        await markAudioCaptureGranted();
        onGranted?.();
        return;
      }

      const result = await requestAudioCapturePermission();
      if (result === 'granted' || result === 'no_device') {
        // no_device = no physical mic, but virtual app audio capture is still OK.
        setPermState('granted');
        await markAudioCaptureGranted();
        onGranted?.();
        return;
      }

      setPermState('denied');
      setLocalError(
        `Still blocked. In microphone settings, allow this exact origin: ${extensionMicSettingsOrigin()}`
      );
    } finally {
      setBusy(false);
    }
  };

  const openMicSettings = (e: React.MouseEvent) => {
    e.preventDefault();
    chrome.tabs.create({ url: extensionMicSettingsUrl() });
  };

  if (!show) return null;

  const isDenied = permState === 'denied';

  return (
    <div
      className={`sp-alert ${isDenied ? 'sp-alert--error' : 'sp-alert--warn'}`}
      style={{ margin: '0 12px 8px' }}
    >
      <strong>{isDenied ? 'Audio device access blocked' : 'Audio device access required'}</strong>
      <p style={{ margin: '6px 0 8px', fontSize: '0.9em', lineHeight: 1.4 }}>
        Chrome needs audio device access to record application/screen audio via the virtual
        device. This is separate from the <strong>Microphone</strong> toggle above.
      </p>

      {isDenied ? (
        <p style={{ margin: '0 0 8px', fontSize: '0.9em' }}>
          Allow microphone for{' '}
          <code style={{ fontSize: '0.85em' }}>{extensionMicSettingsOrigin()}</code>
          {' '}in{' '}
          <a
            href={extensionMicSettingsUrl()}
            onClick={openMicSettings}
            style={{ color: 'inherit', textDecoration: 'underline' }}
          >
            site settings
          </a>
          , then click Re-check.
        </p>
      ) : null}

      <div className="sp-audio-controls-row" style={{ marginTop: 4 }}>
        <button
          type="button"
          className="sp-btn sp-btn--primary sp-btn--sm"
          onClick={() => void handleGrant()}
          disabled={busy}
        >
          {busy ? 'Requesting…' : isDenied ? 'Re-check' : 'Allow audio device access'}
        </button>
      </div>

      {localError && (
        <div className="sp-alert sp-alert--error sp-alert--sm" style={{ marginTop: 6 }}>
          {localError}
        </div>
      )}
    </div>
  );
}
