import { RECORDING_LIMITS, type RecordingLimitEvent } from './recordingLimits';

export class RecordingDurationLimiter {
  private hasConfirmedDurationExtension = false;
  private triggeredEvents = new Set<RecordingLimitEvent>();
  private onLimitEvent: (event: RecordingLimitEvent, elapsedMs: number, message: string) => void;

  constructor(onLimitEvent: (event: RecordingLimitEvent, elapsedMs: number, message: string) => void) {
    this.onLimitEvent = onLimitEvent;
  }

  public check(elapsedMs: number): void {
    const limits = RECORDING_LIMITS;

    if (elapsedMs >= limits.maxDurationMs) {
      this.trigger('MAX_DURATION_REACHED', elapsedMs,
        'Maximum recording duration reached. Recording has been stopped automatically.');
    } else if (elapsedMs >= limits.maxDurationMs - limits.warningBeforeMaxMs) {
      this.trigger('MAX_DURATION_SOON', elapsedMs,
        'Recording will automatically stop in 5 minutes. Maximum duration is 45 minutes.');
    } else if (elapsedMs >= limits.recommendedDurationMs) {
      if (!this.hasConfirmedDurationExtension) {
        this.trigger('WAITING_DURATION_DECISION', elapsedMs,
          'Recommended 30-minute recording duration reached. Do you want to stop now or continue recording for up to 15 more minutes?');
      }
    } else if (elapsedMs >= limits.recommendedDurationMs - limits.warningBeforeRecommendedMs) {
      this.trigger('RECOMMENDED_DURATION_SOON', elapsedMs,
        'Recording is close to the recommended 30-minute duration. Please prepare to finish the consultation.');
    }
  }

  public setConfirmedExtension(val: boolean): void {
    this.hasConfirmedDurationExtension = val;
  }

  public getConfirmedExtension(): boolean {
    return this.hasConfirmedDurationExtension;
  }

  private trigger(event: RecordingLimitEvent, elapsedMs: number, message: string): void {
    if (this.triggeredEvents.has(event)) return;
    this.triggeredEvents.add(event);
    this.onLimitEvent(event, elapsedMs, message);
  }

  public reset(): void {
    this.hasConfirmedDurationExtension = false;
    this.triggeredEvents.clear();
  }
}
