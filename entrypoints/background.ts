import { logDebug } from '../src/logger';

export default defineBackground(() => {
  logDebug('INFO', 'BACKGROUND_INITIALIZED', { reason: 'Background Service Worker startup' });

  let offscreenCreating: Promise<void> | null = null;

  // Helper to ensure offscreen document exists
  async function setupOffscreen() {
    const offscreenUrl = chrome.runtime.getURL('/offscreen.html');
    
    // Check if document already exists
    // @ts-ignore - chrome.runtime.getContexts is available in MV3 Chrome 116+
    if (chrome.runtime.getContexts) {
      // @ts-ignore
      const contexts = await chrome.runtime.getContexts({
        contextTypes: ['OFFSCREEN_DOCUMENT'],
        documentUrls: [offscreenUrl]
      });
      if (contexts.length > 0) {
        return;
      }
    } else {
      // Fallback check for older chrome versions
      const clients = await clients.matchAll();
      for (const client of clients) {
        if (client.url === offscreenUrl) return;
      }
    }

    if (offscreenCreating) {
      await offscreenCreating;
      return;
    }

    logDebug('INFO', 'OFFSCREEN_CREATING', { url: offscreenUrl });
    offscreenCreating = chrome.offscreen.createDocument({
      url: '/offscreen.html',
      reasons: [chrome.offscreen.Reason.DISPLAY_MEDIA, chrome.offscreen.Reason.BLOBS],
      justification: 'Capture tab audio/video and manage persistence queue.'
    });

    try {
      await offscreenCreating;
      logDebug('INFO', 'OFFSCREEN_CREATED');
    } catch (e: any) {
      logDebug('ERROR', 'OFFSCREEN_CREATE_FAILED', { error: e.message });
      throw e;
    } finally {
      offscreenCreating = null;
    }
  }

  // Close offscreen document helper
  async function closeOffscreen() {
    try {
      logDebug('INFO', 'OFFSCREEN_CLOSING');
      await chrome.offscreen.closeDocument();
      logDebug('INFO', 'OFFSCREEN_CLOSED');
    } catch (err: any) {
      logDebug('WARN', 'OFFSCREEN_CLOSE_EXCEPTION', { error: err.message });
    }
  }

  // Listen for tab URL updates (backup SPA navigation helper)
  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.url) {
      const isMeet = changeInfo.url.includes('meet.google.com');
      const isTeams = changeInfo.url.includes('teams.microsoft.com') || changeInfo.url.includes('teams.live.com');
      if (isMeet || isTeams) {
        logDebug('INFO', 'TAB_NAVIGATION_DETECTED', {
          tabId,
          url: changeInfo.url,
          platform: isMeet ? 'meet' : 'teams'
        });
        chrome.tabs.sendMessage(tabId, {
          type: 'TAB_NAVIGATION_EVENT',
          url: changeInfo.url
        }).catch(() => {
          // Quietly ignore if content script isn't listening yet
        });
      }
    }
  });

  // Listen for messages from Content Script or Popup
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // Only log essential routing messages to storage to avoid loop inflation
    if (['START_RECORDING', 'STOP_RECORDING', 'PAUSE_RECORDING', 'RESUME_RECORDING'].includes(message.type)) {
      logDebug('INFO', 'BACKGROUND_ACTION_REQUESTED', { type: message.type });
    }

    if (message.type === 'START_RECORDING') {
      setupOffscreen().then(() => {
        logDebug('INFO', 'FORWARDING_START_RECORDING', { sessionId: message.sessionId });
        chrome.runtime.sendMessage(message, (response) => {
          if (chrome.runtime.lastError) {
            logDebug('ERROR', 'OFFSCREEN_START_RESPOND_FAILED', { error: chrome.runtime.lastError.message });
            sendResponse({ success: false, error: 'Offscreen document did not respond' });
          } else {
            sendResponse(response);
          }
        });
      }).catch(err => {
        logDebug('ERROR', 'START_RECORDING_PIPELINE_FAILED', { error: err.message });
        sendResponse({ success: false, error: err.message });
      });
      return true; // Keep channel open for async response
    }

    if (message.type === 'STOP_RECORDING') {
      logDebug('INFO', 'FORWARDING_STOP_RECORDING');
      // Forward stop to offscreen, wait for it to finish flushing, then tear down
      chrome.runtime.sendMessage(message, (response) => {
        const hasError = chrome.runtime.lastError;
        if (hasError) {
          logDebug('WARN', 'OFFSCREEN_STOP_RESPOND_FAILED', { error: 'Offscreen was not active or responded with error' });
          closeOffscreen();
          sendResponse({ success: false, error: 'Offscreen document was not active' });
        } else {
          logDebug('INFO', 'STOP_RECORDING_COMPLETED_OFFSCREEN');
          closeOffscreen();
          sendResponse(response);
        }
      });
      return true;
    }

    // Forward any other control messages to offscreen
    if (['PAUSE_RECORDING', 'RESUME_RECORDING', 'GET_STATUS', 'EXPORT_RECORDING', 'DELETE_RECORDING'].includes(message.type)) {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          if (message.type === 'GET_STATUS') {
            sendResponse({ success: true, recording: 'inactive', duration: 0, sessionId: null, hasAudio: true });
          } else {
            sendResponse({ success: false, error: 'Offscreen document was not active' });
          }
        } else {
          sendResponse(response);
        }
      });
      return true;
    }

    // Messages from Offscreen back to tabs (for UI updates)
    if (message.type === 'RECORDING_STATE_CHANGED' || message.type === 'UPLOAD_PROGRESS_UPDATE' || message.type === 'AUDIO_STATUS_CHANGED') {
      // Broadcast to all active content tabs
      chrome.tabs.query({}, (tabs) => {
        for (const tab of tabs) {
          if (tab.id && tab.url && (tab.url.includes('meet.google.com') || tab.url.includes('teams.microsoft.com') || tab.url.includes('teams.live.com'))) {
            chrome.tabs.sendMessage(tab.id, message).catch(() => {
              // Ignore errors for tabs without active content script listeners
            });
          }
        }
      });
      sendResponse({ success: true });
      return false;
    }
  });
});
