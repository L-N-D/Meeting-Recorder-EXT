/**
 * Tracks whitelisted Chrome tabs and emits switch events for Focus 1-1 recording.
 */
export class TabFocusDetector {
  private monitoredTabIds = new Set<number>();
  private enabled = false;
  private onSwitch: (tabId: number) => void;

  constructor(onSwitch: (tabId: number) => void) {
    this.onSwitch = onSwitch;
  }

  start(initialTabIds: number[] = []): void {
    this.monitoredTabIds = new Set(initialTabIds.filter((id) => id > 0));
    this.enabled = true;
    chrome.tabs.onActivated.addListener(this.handleActivated);
    chrome.tabs.onRemoved.addListener(this.handleRemoved);
  }

  stop(): void {
    this.enabled = false;
    chrome.tabs.onActivated.removeListener(this.handleActivated);
    chrome.tabs.onRemoved.removeListener(this.handleRemoved);
    this.monitoredTabIds.clear();
  }

  /**
   * Adds a tab to the monitored set after the user has armed it (granting the
   * activeTab capture grant). Subsequent switches to it are then automatic.
   */
  addTab(tabId: number): void {
    if (tabId > 0) {
      this.monitoredTabIds.add(tabId);
    }
  }

  isMonitored(tabId: number): boolean {
    return this.monitoredTabIds.has(tabId);
  }

  private handleActivated = (info: { tabId: number; windowId: number }): void => {
    if (!this.enabled) {
      return;
    }

    if (this.monitoredTabIds.has(info.tabId)) {
      this.onSwitch(info.tabId);
    }
  };

  private handleRemoved = (tabId: number): void => {
    this.monitoredTabIds.delete(tabId);
  };
}
