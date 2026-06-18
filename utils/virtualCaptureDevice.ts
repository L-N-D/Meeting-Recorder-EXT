/**
 * Chrome virtual capture device selection.
 * Chrome exposes remap mics with human labels (e.g. "Application") and opaque
 * deviceIds — not PulseAudio source names. Selection uses enumerateDevices()
 * baseline diff only.
 */

export interface PulseSourceInfo {
  index: number;
  name: string;
  driver: string;
  state: string;
  isMonitor?: boolean;
}

/** Authoritative capture target returned by prepareApplicationAudio. */
export interface VirtualCaptureTarget {
  /** Pulse remap mic name — informational; not used for Chrome device matching */
  chromeCaptureSource: string;
  sourceName: string;
  sinkName: string;
  monitorSource?: string;
  pulseSourceIndex: number | null;
  sessionName: string;
  pulseSources?: PulseSourceInfo[];
}

export interface ChromeAudioInputInfo {
  deviceId: string;
  label: string;
  groupId: string;
}

/** audioinput devices whose deviceId was not present in the pre-capture baseline. */
export function findNovelChromeCaptureInputs(
  devices: MediaDeviceInfo[],
  baselineDeviceIds: ReadonlySet<string>
): ChromeAudioInputInfo[] {
  return devices
    .filter((d) => d.kind === 'audioinput' && !baselineDeviceIds.has(d.deviceId))
    .map((d) => ({ deviceId: d.deviceId, label: d.label, groupId: d.groupId }));
}

/** Pick the best novel device when Chrome adds more than one audioinput. */
export function pickNovelCaptureDevice(
  novel: ChromeAudioInputInfo[]
): ChromeAudioInputInfo | null {
  if (!novel.length) return null;
  if (novel.length === 1) return novel[0];

  const preferred = novel.filter(
    (d) =>
      d.label &&
      d.label !== 'Default' &&
      !d.label.toLowerCase().startsWith('mirror of ')
  );
  return preferred[0] ?? novel[0];
}

/** Select the Chrome capture device created after the native virtual sink. */
export function selectChromeCaptureDevice(
  devices: MediaDeviceInfo[],
  baselineDeviceIds: ReadonlySet<string>
): ChromeAudioInputInfo | null {
  return pickNovelCaptureDevice(findNovelChromeCaptureInputs(devices, baselineDeviceIds));
}

export function logChromeAudioInputsTable(devices: MediaDeviceInfo[]): void {
  console.table(
    devices
      .filter((d) => d.kind === 'audioinput')
      .map((d) => ({
        deviceId: d.deviceId,
        label: d.label || '(empty)',
        kind: d.kind,
        groupId: d.groupId || '',
      }))
  );
}

/** Confirm getUserMedia opened a novel capture device (not a pre-existing mic). */
export function verifyOpenedCaptureTrack(
  track: MediaStreamTrack,
  baselineDeviceIds: ReadonlySet<string>
): boolean {
  const settings = track.getSettings() as MediaTrackSettings & { deviceId?: string };
  const openedId = settings.deviceId ?? '';
  if (!openedId || baselineDeviceIds.has(openedId)) return false;

  const label = track.label.toLowerCase();
  if (label.startsWith('mirror of ')) return false;
  if (label.includes('.monitor')) return false;
  return true;
}

export function formatAudioInputsForLog(devices: MediaDeviceInfo[]): string {
  return devices
    .filter((d) => d.kind === 'audioinput')
    .map(
      (d) =>
        `{id:"${d.deviceId}" label:"${d.label || '(empty)'}" group:"${d.groupId || ''}"}`
    )
    .join(' | ');
}

export function captureTargetFromPrepareResult(
  result: {
    chromeCaptureSource?: string;
    sourceName?: string;
    audioDeviceId?: string;
    monitorSource?: string;
    sinkName?: string;
    sink?: string;
    pulseSourceIndex?: number | null;
    sessionName?: string;
    chromeLabelHint?: string;
    pulseSources?: PulseSourceInfo[];
  },
  fallbackSessionName: string
): VirtualCaptureTarget {
  const sinkName = result.sinkName ?? result.sink ?? '';
  const chromeCaptureSource =
    result.chromeCaptureSource ??
    result.sourceName ??
    result.audioDeviceId ??
    `${sinkName}_mic`;
  const remapEntry =
    result.pulseSources?.find((s) => s.name === chromeCaptureSource) ??
    result.pulseSources?.find((s) => !s.isMonitor && !s.name.endsWith('.monitor'));
  return {
    chromeCaptureSource,
    sourceName: chromeCaptureSource,
    sinkName,
    monitorSource: result.monitorSource ?? `${sinkName}.monitor`,
    pulseSourceIndex: result.pulseSourceIndex ?? remapEntry?.index ?? null,
    sessionName: result.sessionName ?? result.chromeLabelHint ?? fallbackSessionName,
    pulseSources: result.pulseSources,
  };
}
