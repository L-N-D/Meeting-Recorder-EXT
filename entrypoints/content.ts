/**
 * Floating status bubble shown on every page while a Focus recording is active.
 *
 * It tells the user, on whatever tab they are viewing:
 *   - that a recording is in progress (with a live timer),
 *   - whether THIS tab is the one currently being recorded,
 *   - and, when this tab is not yet armed, how to start recording it.
 *
 * Chrome forbids granting tab-capture permission from a content-script button
 * (only browser-action / context-menu / keyboard-command invocations grant it),
 * so the bubble guides the user to press Alt+Shift+F, which is a one-key action
 * that both grants the permission and switches the recording to this tab.
 */

interface BubbleStatus {
  active: boolean;
  paused: boolean;
  duration: number;
  armed: boolean;
  isCurrent: boolean;
  capturable: boolean;
}

const HOST_ID = 'virtual-ext-focus-bubble-host';

export default defineContentScript({
  matches: ['http://*/*', 'https://*/*'],
  runAt: 'document_idle',
  allFrames: false,
  main() {
    let host: HTMLElement | null = null;
    let shadow: ShadowRoot | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;

    const formatTime = (totalSeconds: number): string => {
      const s = Math.max(0, Math.floor(totalSeconds));
      const hrs = Math.floor(s / 3600);
      const mins = Math.floor((s % 3600) / 60);
      const secs = s % 60;
      const pad = (n: number) => String(n).padStart(2, '0');
      return hrs > 0 ? `${pad(hrs)}:${pad(mins)}:${pad(secs)}` : `${pad(mins)}:${pad(secs)}`;
    };

    function ensureHost(): ShadowRoot {
      if (shadow) {
        return shadow;
      }
      host = document.createElement('div');
      host.id = HOST_ID;
      host.style.cssText = 'all: initial; position: fixed; z-index: 2147483647;';
      shadow = host.attachShadow({ mode: 'open' });
      shadow.innerHTML = `
        <style>
          :host { all: initial; }
          .bubble {
            position: fixed;
            right: 16px;
            bottom: 16px;
            display: flex;
            align-items: center;
            gap: 10px;
            max-width: 320px;
            padding: 10px 14px;
            border-radius: 12px;
            background: rgba(17, 24, 39, 0.95);
            color: #f9fafb;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            font-size: 13px;
            line-height: 1.35;
            box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
            border: 1px solid rgba(255, 255, 255, 0.08);
            cursor: default;
            user-select: none;
          }
          .bubble.warn { border-color: rgba(245, 158, 11, 0.6); }
          .dot {
            width: 10px; height: 10px; border-radius: 50%;
            background: #ef4444; flex: 0 0 auto;
          }
          .dot.recording { animation: pulse 1.4s ease-in-out infinite; }
          .dot.idle { background: #9ca3af; }
          .dot.paused { background: #f59e0b; animation: none; }
          @keyframes pulse {
            0%, 100% { opacity: 1; transform: scale(1); }
            50% { opacity: 0.35; transform: scale(0.82); }
          }
          .body { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
          .title { font-weight: 600; }
          .sub { color: #cbd5e1; font-size: 12px; }
          .kbd {
            display: inline-block;
            padding: 1px 6px;
            border-radius: 5px;
            background: rgba(255,255,255,0.14);
            border: 1px solid rgba(255,255,255,0.18);
            font-weight: 600;
            font-size: 11px;
          }
          .timer { font-variant-numeric: tabular-nums; color: #e5e7eb; }
        </style>
        <div class="bubble" part="bubble">
          <span class="dot"></span>
          <div class="body">
            <span class="title"></span>
            <span class="sub"></span>
          </div>
        </div>
      `;
      document.documentElement.appendChild(host);
      return shadow;
    }

    function removeHost(): void {
      if (host && host.parentNode) {
        host.parentNode.removeChild(host);
      }
      host = null;
      shadow = null;
    }

    function render(status: BubbleStatus | null): void {
      if (!status || !status.active) {
        removeHost();
        return;
      }

      const root = ensureHost();
      const bubble = root.querySelector('.bubble') as HTMLElement;
      const dot = root.querySelector('.dot') as HTMLElement;
      const title = root.querySelector('.title') as HTMLElement;
      const sub = root.querySelector('.sub') as HTMLElement;

      const time = formatTime(status.duration);
      bubble.classList.remove('warn');
      dot.className = 'dot';

      if (status.isCurrent) {
        dot.classList.add(status.paused ? 'paused' : 'recording');
        title.textContent = status.paused ? 'Paused — this tab' : 'Recording this tab';
        sub.innerHTML = `<span class="timer">${time}</span>`;
      } else if (status.armed) {
        dot.classList.add('idle');
        title.textContent = 'This tab is ready';
        sub.innerHTML = `Recording another tab now · <span class="timer">${time}</span>`;
      } else if (status.capturable) {
        bubble.classList.add('warn');
        dot.classList.add('idle');
        title.textContent = 'This tab is NOT being recorded';
        sub.innerHTML = `Press <span class="kbd">Alt</span>+<span class="kbd">Shift</span>+<span class="kbd">F</span> to record it`;
      } else {
        dot.classList.add('idle');
        title.textContent = 'This page cannot be recorded';
        sub.innerHTML = `Only http/https tabs · <span class="timer">${time}</span>`;
      }
    }

    async function refresh(): Promise<void> {
      let status: BubbleStatus | null = null;
      try {
        status = (await chrome.runtime.sendMessage({ type: 'GET_BUBBLE_STATUS' })) as BubbleStatus;
      } catch {
        status = null;
      }
      render(status);
      managePolling(Boolean(status?.active) && document.visibilityState === 'visible');
    }

    function managePolling(shouldPoll: boolean): void {
      if (shouldPoll && pollTimer === null) {
        pollTimer = setInterval(() => void refresh(), 1000);
      } else if (!shouldPoll && pollTimer !== null) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    }

    chrome.runtime.onMessage.addListener((message) => {
      if (message?.type === 'BUBBLE_REFRESH') {
        void refresh();
      }
    });

    document.addEventListener('visibilitychange', () => void refresh());

    void refresh();
  },
});
