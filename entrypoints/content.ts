import '../src/bypass-csp';
import { createApp, ref, h } from 'vue';
import { logDebug } from '../src/logger';
import MeetingPrompt from '@/components/MeetingPrompt.vue';
import RecorderOverlay from '@/components/RecorderOverlay.vue';
import RecoveryDialog from '@/components/RecoveryDialog.vue';
import '@/assets/tailwind.css';

export default defineContentScript({
  matches: ['*://meet.google.com/*', '*://teams.microsoft.com/*', '*://teams.live.com/*'],
  runAt: 'document_idle',
  main(ctx) {
    console.log('Meeting Data Collection Content Script loaded.');

    let promptApp: any = null;
    let promptContainer: HTMLDivElement | null = null;

    let overlayApp: any = null;
    let overlayContainer: HTMLDivElement | null = null;

    let recoveryApp: any = null;
    let recoveryContainer: HTMLDivElement | null = null;

    // Overlay state
    const overlayStatus = ref<'recording' | 'paused' | 'completed' | 'failed' | 'inactive'>('inactive');
    const overlayDuration = ref(0);
    const overlayHasAudio = ref(true);
    const overlayUploaded = ref(0);
    const overlayTotal = ref(0);

    const platform = window.location.host.includes('meet.google') ? 'meet' : 'teams';

    // --- Helper: Detect Active Meeting Session ---
    function isMeetingActive(silent = true): boolean {
      const isMeetURL = window.location.host.includes('meet.google');
      const isTeamsURL = window.location.host.includes('teams.microsoft.com') || window.location.host.includes('teams.live.com');

      if (!silent) {
        logDebug(`Running DOM detection scan. Host: ${window.location.host}, Path: ${window.location.pathname}`, 'scan');
      }

      if (isMeetURL) {
        const leaveBtn = document.querySelector(
          'button[aria-label*="leave" i], button[aria-label*="rời" i], button[aria-label*="kết thúc" i], button[data-tooltip*="leave" i], button[data-tooltip*="rời" i], [data-icon-type="call-end"], button[aria-label*="hang" i]'
        );
        const micBtn = document.querySelector(
          'button[aria-label*="microphone" i], button[aria-label*="mute" i], button[aria-label*="tắt tiếng" i], button[aria-label*="bật tiếng" i], button[aria-label*="micrô" i], button[data-is-muted]'
        );
        
        if (!silent) {
          logDebug(`Google Meet scan: Leave button = ${leaveBtn ? 'FOUND' : 'NOT FOUND'}, Mic controls = ${micBtn ? 'FOUND' : 'NOT FOUND'}. Active: ${!!(leaveBtn && micBtn)}`, 'scan');
        }
        return !!(leaveBtn && micBtn);
      } else if (isTeamsURL) {
        const hangupBtn = document.querySelector(
          'button[data-tid="hangup-button"], button[aria-label*="hang up" i], button[aria-label*="rời" i], button[aria-label*="leave" i], button[aria-label*="gác máy" i], button[id*="hangup"]'
        );
        const micBtn = document.querySelector(
          'button[aria-label*="mute" i], button[aria-label*="tắt tiếng" i], button[aria-label*="bật tiếng" i], button[aria-label*="mic" i], button[id*="microphone"]'
        );
        
        if (!silent) {
          logDebug(`MS Teams scan: Hangup button = ${hangupBtn ? 'FOUND' : 'NOT FOUND'}, Mic controls = ${micBtn ? 'FOUND' : 'NOT FOUND'}. Active: ${!!(hangupBtn && micBtn)}`, 'scan');
        }
        return !!(hangupBtn && micBtn);
      }
      
      if (!silent) {
        logDebug(`Host URL not recognized for meeting capture.`, 'scan');
      }
      return false;
    }

    // --- Helper: Generate Session ID ---
    function getSessionId(): string {
      let sid = sessionStorage.getItem('meeting_collector_session_id');
      if (!sid) {
        sid = 'session_' + crypto.randomUUID();
        sessionStorage.setItem('meeting_collector_session_id', sid);
      }
      return sid;
    }

    // --- Mount UI Utilities ---
    function showMeetingPrompt() {
      if (sessionStorage.getItem('meeting_collector_prompted') || promptContainer) return;

      promptContainer = document.createElement('div');
      promptContainer.id = 'meeting-collector-prompt-root';
      document.body.appendChild(promptContainer);

      promptApp = createApp({
        render() {
          return h(MeetingPrompt, {
            platform,
            onStart() {
              sessionStorage.setItem('meeting_collector_prompted', 'started');
              dismissPrompt();
              triggerStartRecording();
            },
            onDismiss() {
              sessionStorage.setItem('meeting_collector_prompted', 'dismissed');
              dismissPrompt();
            }
          });
        }
      });
      promptApp.mount(promptContainer);
    }

    function dismissPrompt() {
      if (promptApp) {
        promptApp.unmount();
        promptApp = null;
      }
      if (promptContainer) {
        promptContainer.remove();
        promptContainer = null;
      }
    }

    function mountRecorderOverlay() {
      if (overlayContainer) return;

      overlayContainer = document.createElement('div');
      overlayContainer.id = 'meeting-collector-overlay-root';
      document.body.appendChild(overlayContainer);

      overlayApp = createApp({
        setup() {
          return {
            status: overlayStatus,
            duration: overlayDuration,
            hasAudio: overlayHasAudio,
            uploaded: overlayUploaded,
            total: overlayTotal
          };
        },
        render() {
          return h(RecorderOverlay, {
            status: this.status,
            duration: this.duration,
            hasAudio: this.hasAudio,
            uploadedChunks: this.uploaded,
            totalChunks: this.total,
            onPause() {
              chrome.runtime.sendMessage({ type: 'PAUSE_RECORDING' });
            },
            onResume() {
              chrome.runtime.sendMessage({ type: 'RESUME_RECORDING' });
            },
            onStop() {
              chrome.runtime.sendMessage({ type: 'STOP_RECORDING' });
            }
          });
        }
      });
      overlayApp.mount(overlayContainer);
    }

    function unmountRecorderOverlay() {
      if (overlayApp) {
        overlayApp.unmount();
        overlayApp = null;
      }
      if (overlayContainer) {
        overlayContainer.remove();
        overlayContainer = null;
      }
    }

    // --- Actions ---
    function triggerStartRecording() {
      const sessionId = getSessionId();
      chrome.runtime.sendMessage({
        type: 'START_RECORDING',
        sessionId,
        platform
      }, (response) => {
        if (response && response.success) {
          overlayStatus.value = 'recording';
          overlayDuration.value = 0;
          mountRecorderOverlay();
        } else {
          console.error('Failed to trigger recording:', response?.error);
        }
      });
    }

    // --- Message Listener ---
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.type === 'CHECK_MEETING_ACTIVE') {
        const active = isMeetingActive(true);
        sendResponse({ success: true, active, platform });
        return false;
      }

      if (message.type === 'TRIGGER_REDETECT') {
        logDebug('Manual Re-detect requested via extension dashboard.', 'scan');
        sessionStorage.removeItem('meeting_collector_prompted'); // Reset dismissal state
        const active = isMeetingActive(false); // Run non-silent scan
        if (active) {
          showMeetingPrompt();
          sendResponse({ success: true, active: true, message: 'Active meeting page detected! Consent UI mounted.' });
        } else {
          sendResponse({ success: true, active: false, message: 'No active meeting controls found. Check logs below.' });
        }
        return false;
      }

      if (message.type === 'RECORDING_STATE_CHANGED') {
        if (message.status === 'recording' || message.status === 'paused') {
          overlayStatus.value = message.status;
          overlayDuration.value = message.duration || 0;
          overlayTotal.value = Math.max(overlayTotal.value, Math.ceil((message.duration || 0) / 5));
          mountRecorderOverlay();
        } else if (message.status === 'completed' || message.status === 'failed') {
          overlayStatus.value = message.status;
          if (message.error) {
            alert(`Recording Issue: ${message.error}`);
          }
          // Hold UI visible for completed, unmount after short delay
          setTimeout(() => {
            unmountRecorderOverlay();
          }, 3000);
        }
      }

      if (message.type === 'UPLOAD_PROGRESS_UPDATE') {
        if (message.status === 'uploaded') {
          overlayUploaded.value++;
        }
        overlayTotal.value = Math.max(overlayTotal.value, message.chunkIndex + 1);
      }

      if (message.type === 'AUDIO_STATUS_CHANGED') {
        overlayHasAudio.value = message.hasAudio;
      }
    });

    // --- Recovery & Sync Checks on Load ---
    function checkRunningSessions() {
      chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (response) => {
        if (response && response.recording !== 'inactive') {
          overlayStatus.value = response.recording === 'recording' ? 'recording' : 'paused';
          overlayDuration.value = response.duration || 0;
          overlayHasAudio.value = response.hasAudio;
          overlayTotal.value = Math.ceil(response.duration / 5);
          mountRecorderOverlay();
        } else {
          // No active recording, check if we need to show Meeting Prompt
          checkForMeetingPrompt();
        }
      });
    }

    function checkForMeetingPrompt() {
      let checks = 0;
      const interval = setInterval(() => {
        checks++;
        if (isMeetingActive()) {
          clearInterval(interval);
          showMeetingPrompt();
        } else if (checks > 30) {
          clearInterval(interval); // Stop after 30 seconds of checking
        }
      }, 1000);
    }

    // Execute state checks
    checkRunningSessions();
  }
});
