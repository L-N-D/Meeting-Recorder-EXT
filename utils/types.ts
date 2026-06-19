export type RecordingState = 'idle' | 'starting' | 'recording' | 'paused' | 'interrupted';

export interface ActiveSessionMetadata {
  sessionId: string;
  startTime: number;
  mimeType: string;
  duration: number;
  focusMode: boolean;
  includeMic: boolean;
  includeCam: boolean;
  isActive: boolean;
  status: 'recording' | 'paused' | 'crashed' | 'completed';
  lastChunkTime: number;
  lastUpdateTime: number;
  chunkCount: number;
  captureSource?: string;
}

export interface AudioMixSettings {
  systemGain: number;
  micGain: number;
  routeSystemToSpeakers: boolean;
}

export const DEFAULT_AUDIO_SETTINGS: AudioMixSettings = {
  systemGain: 0.75,
  micGain: 1.3,
  routeSystemToSpeakers: false,
};

// ---- Native audio / application mirror types --------------------------------

/** Status of the persistent connection to the native messaging host. */
export type NativeHelperStatus = 'unknown' | 'connected' | 'not_installed' | 'error';

/**
 * Status of the current audio routing session.
 * idle        → no session active
 * preparing   → createVirtualDevice in progress
 * virtual_device_ready → sink loaded, ready to receive getUserMedia
 * mirroring   → at least one app is linked into the virtual sink
 * error       → session setup failed
 */
export type AudioSessionStatus =
  | 'idle'
  | 'preparing'
  | 'virtual_device_ready'
  | 'mirroring'
  | 'error';

/**
 * One application whose audio is currently being mirrored into the
 * virtual sink. Future multi-app support just adds more entries here.
 */
export interface AudioSession {
  pid: number;
  name: string;
  nodeIds: number[];
  linksCreated: number;
}

/** Full state of the native audio subsystem, broadcast by the background SW. */
export interface AppAudioState {
  nativeHelperStatus: NativeHelperStatus;
  sessionStatus: AudioSessionStatus;
  /** PulseAudio device label Chrome will show in enumerateDevices(). */
  deviceLabelHint: string | null;
  /** Array of currently active mirrors — designed for future multi-app. */
  mirrors: AudioSession[];
  error: string | null;
}

export const DEFAULT_APP_AUDIO_STATE: AppAudioState = {
  nativeHelperStatus: 'unknown',
  sessionStatus: 'idle',
  deviceLabelHint: null,
  mirrors: [],
  error: null,
};

// ---- Recording status payload (extended) ------------------------------------

export interface RecordingStatusPayload {
  recordingState: RecordingState;
  duration: number;
  error: string | null;
  includeMic: boolean;
  includeCam: boolean;
  focusMode: boolean;
  audioSettings: AudioMixSettings;
  appAudio: AppAudioState;
}

// ---- Log lines broadcast from background ------------------------------------

export interface LogLine {
  ts: number;
  level: 'info' | 'warn' | 'error';
  msg: string;
}
