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
      style={{ margin: '12px 18px 0' }}
    >
      <strong style={{ fontSize: '12px' }}>
        {isDenied ? 'Audio device access blocked' : 'System audio capture setup'}
      </strong>
      <p style={{ margin: '4px 0 6px', fontSize: '11px', lineHeight: 1.4, opacity: 0.9 }}>
        Chrome requires audio input permission to record application or screen audio via the virtual device. This is separate from the physical microphone.
      </p>

      {isDenied ? (
        <p style={{ margin: '0 0 6px', fontSize: '11px' }}>
          Allow microphone for{' '}
          <code style={{ fontSize: '10.5px', background: 'rgba(0,0,0,0.2)', padding: '1px 3px', borderRadius: '3px' }}>
            {extensionMicSettingsOrigin()}
          </code>
          {' '}in{' '}
          <a
            href={extensionMicSettingsUrl()}
            onClick={openMicSettings}
            style={{ color: 'inherit', textDecoration: 'underline', fontWeight: 600 }}
          >
            Chrome site settings
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
          {busy ? 'Requesting…' : isDenied ? 'Re-check' : 'Grant Permission'}
        </button>
      </div>

      {localError && (
        <div className="sp-alert sp-alert--error sp-alert--sm" style={{ marginTop: 6, padding: '6px 8px' }}>
          {localError}
        </div>
      )}
    </div>
  );
}
