export const RECORDING_LIMITS = {
  recommendedDurationMs: 30 * 60 * 1000,
  maxDurationMs: 45 * 60 * 1000,
  warningBeforeRecommendedMs: 5 * 60 * 1000,
  warningBeforeMaxMs: 5 * 60 * 1000,
  tickIntervalMs: 1000
};

export type RecordingLimitEvent =
  | 'RECOMMENDED_DURATION_SOON'
  | 'RECOMMENDED_DURATION_REACHED'
  | 'WAITING_DURATION_DECISION'
  | 'USER_CHOSE_STOP_AT_RECOMMENDED'
  | 'USER_CHOSE_CONTINUE_TO_MAX'
  | 'MAX_DURATION_SOON'
  | 'MAX_DURATION_REACHED';
