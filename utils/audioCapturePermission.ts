/**
 * Audio capture permission helpers for the sidepanel.
 *
 * Chrome extensions cannot rely on navigator.permissions.query({ name: 'microphone' })
 * in the sidepanel — it often fails or returns stale state. Instead we probe via
 * enumerateDevices() (labels are empty until permission is granted) and only call
 * getUserMedia on an explicit user gesture (the Grant button).
 */

export type AudioCapturePermState = 'granted' | 'denied' | 'prompt' | 'unknown';

export type AudioCaptureRequestResult = 'granted' | 'denied' | 'no_device';

/** True when enumerateDevices() exposes at least one labelled audioinput. */
export function hasLabelledAudioInputs(devices: MediaDeviceInfo[]): boolean {
  return devices.some((d) => d.kind === 'audioinput' && d.label.trim() !== '');
}

/**
 * Probe whether Chrome will expose audio input device labels to this extension.
 * Does NOT trigger a permission dialog.
 *
 * Order matters: permissions.query reflects Chrome settings changes immediately,
 * while enumerateDevices() only shows labels after a successful capture grant
 * (and may stay empty when there is no physical microphone).
 */
export async function probeAudioCapturePermission(): Promise<AudioCapturePermState> {
  try {
    const status = await navigator.permissions.query({ name: 'microphone' as PermissionName });
    if (status.state === 'granted') return 'granted';
    if (status.state === 'denied') return 'denied';
    if (status.state === 'prompt') {
      // Fall through — labels may still prove an earlier grant.
    }
  } catch {
    // permissions API unavailable in this extension context
  }

  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    if (hasLabelledAudioInputs(devices)) return 'granted';
  } catch {
    // fall through
  }

  try {
    const status = await navigator.permissions.query({ name: 'microphone' as PermissionName });
    if (status.state === 'prompt') return 'prompt';
    if (status.state === 'denied') return 'denied';
  } catch {
    // fall through
  }

  return 'unknown';
}

/**
 * Request audio capture permission via getUserMedia. Must be called from a user
 * gesture (button click). Stops tracks immediately — we only need the grant.
 */
export async function requestAudioCapturePermission(): Promise<AudioCaptureRequestResult> {
  // Honour a settings-page Allow without opening the mic (no hardware needed).
  const probed = await probeAudioCapturePermission();
  if (probed === 'granted') return 'granted';

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
    return 'granted';
  } catch (err: unknown) {
    const name = err instanceof DOMException ? err.name : '';
    if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
      // No physical microphone — permission may still be granted in settings.
      const after = await probeAudioCapturePermission();
      if (after === 'granted') return 'granted';
      // Virtual device capture does not require hardware mic; allow proceeding.
      return 'no_device';
    }
    if (name === 'NotAllowedError' || name === 'PermissionDeniedError') return 'denied';
    return 'denied';
  }
}

/** chrome-extension:// origin the user must allow in microphone settings. */
export function extensionMicSettingsOrigin(): string {
  return `chrome-extension://${chrome.runtime.id}`;
}

export function extensionMicSettingsUrl(): string {
  const site = encodeURIComponent(extensionMicSettingsOrigin());
  return `chrome://settings/content/siteDetails?site=${site}`;
}

const STORAGE_KEY = 'audioCaptureGranted';

/** Persist a successful grant for this browser session (probe alone may stay inconclusive). */
export async function markAudioCaptureGranted(): Promise<void> {
  try {
    await chrome.storage.session.set({ [STORAGE_KEY]: true });
  } catch {
    // session storage unavailable — probe-only fallback
  }
}

async function readStoredGrant(): Promise<boolean> {
  try {
    const stored = await chrome.storage.session.get(STORAGE_KEY);
    return Boolean(stored[STORAGE_KEY]);
  } catch {
    return false;
  }
}

/** Whether recording may start (virtual audio capture path). */
export async function isAudioCaptureReady(): Promise<boolean> {
  if ((await probeAudioCapturePermission()) === 'granted') return true;
  return readStoredGrant();
}

/** Native helper connected + not Focus mode → virtual audio capture is needed. */
export function needsVirtualAudioCapture(
  nativeHelperConnected: boolean,
  focusMode: boolean
): boolean {
  return nativeHelperConnected && !focusMode;
}
