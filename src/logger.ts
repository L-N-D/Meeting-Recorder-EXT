// Global Logger for Ingest Pipeline Diagnostics

export interface LogPayload {
  platform?: 'meet' | 'teams';
  url?: string;
  state?: string;
  previousState?: string;
  reason?: string;
  selectorsMatched?: string[];
  error?: string;
  [key: string]: any;
}

const DEBUG_MODE = true; // Set to false to reduce console verbosity in production

export async function logDebug(
  level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR',
  event: string,
  payload?: LogPayload
) {
  if (!DEBUG_MODE && level === 'DEBUG') return;

  const timestamp = new Date().toLocaleTimeString();
  const payloadStr = payload ? ` ${JSON.stringify(payload)}` : '';
  console.log(`[MeetingCollector][${level}][${timestamp}][${event}]${payloadStr}`);
  
  try {
    const data = await chrome.storage.local.get('debug_logs');
    const logs = data.debug_logs || [];
    
    logs.push({
      timestamp,
      level,
      event,
      payload
    });

    // Limit log size to last 100 entries
    if (logs.length > 100) {
      logs.shift();
    }

    await chrome.storage.local.set({ debug_logs: logs });
    
    // Notify active popups/windows to refresh log lists
    chrome.runtime.sendMessage({ type: 'DEBUG_LOGS_UPDATED' }).catch(() => {
      // Ignore errors if no active popup listener
    });
  } catch (e) {
    // Fail silently if context invalidated (e.g. extension reloaded)
  }
}

export async function clearDebugLogs() {
  try {
    await chrome.storage.local.set({ debug_logs: [] });
    chrome.runtime.sendMessage({ type: 'DEBUG_LOGS_UPDATED' }).catch(() => {});
  } catch (e) {}
}

export enum RecorderStatus {
  IDLE = 'IDLE',
  SCANNING = 'SCANNING',
  MEETING_DETECTED = 'MEETING_DETECTED',
  REQUESTING_PERMISSION = 'REQUESTING_PERMISSION',
  PERMISSION_DENIED = 'PERMISSION_DENIED',
  PREPARING = 'PREPARING',
  RECORDING = 'RECORDING',
  PAUSED = 'PAUSED',
  SAVING = 'SAVING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  MEETING_ENDED = 'MEETING_ENDED'
}

export interface ActivityEvent {
  timestamp: string;
  message: string;
}

export async function logActivity(message: string) {
  const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  try {
    const data = await chrome.storage.local.get('activity_feed');
    const feed = data.activity_feed || [];
    feed.push({ timestamp, message });
    if (feed.length > 10) {
      feed.shift();
    }
    await chrome.storage.local.set({ activity_feed: feed });
    chrome.runtime.sendMessage({ type: 'ACTIVITY_FEED_UPDATED' }).catch(() => {});
  } catch (e) {}
}

