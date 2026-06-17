export type RecordingState = 'idle' | 'starting' | 'recording' | 'paused';

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

export interface PendingRecordingIntent {
  includeMic: boolean;
  includeCam: boolean;
  focusMode: boolean;
  audioSettings: AudioMixSettings;
}

export interface RecordingStatusPayload {
  recordingState: RecordingState;
  duration: number;
  error: string | null;
  includeMic: boolean;
  includeCam: boolean;
  focusMode: boolean;
  audioSettings: AudioMixSettings;
}
