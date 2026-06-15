import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Window } from 'happy-dom';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const window = new Window();
const document = window.document;

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message || "Assertion failed");
  }
}

// Selectors
const MEET_SELECTORS = {
  leaveButton: [
    'button[aria-label*="leave" i]',
    'button[aria-label*="rời" i]',
    'button[aria-label*="kết thúc" i]',
    'button[data-tooltip*="leave" i]',
    'button[data-tooltip*="rời" i]',
    '[data-icon-type="call-end"]',
    'button[aria-label*="hang" i]',
    'button[aria-label*="end call" i]',
    'button[data-tooltip*="end call" i]'
  ],
  micButton: [
    'button[aria-label*="microphone" i]',
    'button[aria-label*="mute" i]',
    'button[aria-label*="tắt tiếng" i]',
    'button[aria-label*="bật tiếng" i]',
    'button[aria-label*="micrô" i]',
    'button[data-is-muted]',
    'button[aria-label*="mic" i]'
  ],
  lobbyIndicators: [
    'div[data-promotion-id]',
    '[data-meeting-title]',
    'button[aria-label*="join" i]',
    'button[aria-label*="tham gia" i]',
    'button[aria-label*="ready" i]'
  ]
};

const TEAMS_SELECTORS = {
  leaveButton: [
    'button[data-tid="hangup-button"]',
    'button[aria-label*="hang up" i]',
    'button[aria-label*="rời" i]',
    'button[aria-label*="leave" i]',
    'button[id*="hangup"]',
    'button[aria-label*="hangup" i]'
  ],
  micButton: [
    'button[aria-label*="mute" i]',
    'button[aria-label*="tắt tiếng" i]',
    'button[aria-label*="bật tiếng" i]',
    'button[aria-label*="mic" i]',
    'button[id*="microphone"]',
    'button[aria-label*="microphone" i]'
  ],
  lobbyIndicators: [
    'button[data-tid*="join"]',
    'button[aria-label*="join" i]',
    'button[aria-label*="tham gia" i]'
  ]
};

function findElement(selectors) {
  for (const selector of selectors) {
    const el = document.querySelector(selector);
    if (el) return el;
  }
  return null;
}

function checkActiveControls(platform) {
  const selectors = platform === 'meet' ? MEET_SELECTORS : TEAMS_SELECTORS;
  const leaveBtn = findElement(selectors.leaveButton);
  const micBtn = findElement(selectors.micButton);
  return !!(leaveBtn && micBtn);
}

function checkLobbyIndicators(platform) {
  const selectors = platform === 'meet' ? MEET_SELECTORS : TEAMS_SELECTORS;
  return !!findElement(selectors.lobbyIndicators);
}

function isMeetingUrl(urlStr) {
  try {
    const url = new URL(urlStr);
    if (url.host.includes('meet.google.com')) {
      const path = url.pathname;
      return /^\/[a-z]{3}-[a-z]{4}-[a-z]{3}$/.test(path) || path.startsWith('/lookup/');
    }
    if (url.host.includes('teams.microsoft.com') || url.host.includes('teams.live.com')) {
      const path = url.pathname;
      return path.includes('/l/meetup-join/') || path.includes('/meet/') || path.includes('/v2/');
    }
    return false;
  } catch (e) {
    return false;
  }
}

// Test cases
test('isMeetingUrl validator matches correctly', () => {
  assert(isMeetingUrl('https://meet.google.com/xyz-pdqr-abc') === true, 'Valid Meet URL failed');
  assert(isMeetingUrl('https://meet.google.com/lookup/somecode') === true, 'Valid lookup Meet URL failed');
  assert(isMeetingUrl('https://meet.google.com/') === false, 'Root Meet URL should be invalid');
  assert(isMeetingUrl('https://meet.google.com/landing') === false, 'Landing Meet URL should be invalid');
  
  assert(isMeetingUrl('https://teams.microsoft.com/l/meetup-join/19%3ameeting_Y2...') === true, 'Valid Teams URL failed');
  assert(isMeetingUrl('https://teams.microsoft.com/v2/abc') === true, 'Valid v2 Teams URL failed');
  assert(isMeetingUrl('https://teams.live.com/v2/abc') === true, 'Valid teams.live.com URL failed');
  assert(isMeetingUrl('https://teams.microsoft.com/') === false, 'Root Teams URL should be invalid');
});

test('Google Meet lobby fixture detection', () => {
  const html = fs.readFileSync(path.resolve(__dirname, 'fixtures/meet-lobby.html'), 'utf8');
  document.body.innerHTML = html;
  
  assert(checkActiveControls('meet') === false, 'Active controls found in Meet lobby');
  assert(checkLobbyIndicators('meet') === true, 'Lobby indicators not found in Meet lobby');
});

test('Google Meet active call fixture detection', () => {
  const html = fs.readFileSync(path.resolve(__dirname, 'fixtures/meet-active.html'), 'utf8');
  document.body.innerHTML = html;
  
  assert(checkActiveControls('meet') === true, 'Active controls not found in Meet active call');
});

test('MS Teams lobby fixture detection', () => {
  const html = fs.readFileSync(path.resolve(__dirname, 'fixtures/teams-lobby.html'), 'utf8');
  document.body.innerHTML = html;
  
  assert(checkActiveControls('teams') === false, 'Active controls found in Teams lobby');
  assert(checkLobbyIndicators('teams') === true, 'Lobby indicators not found in Teams lobby');
});

test('MS Teams active call fixture detection', () => {
  const html = fs.readFileSync(path.resolve(__dirname, 'fixtures/teams-active.html'), 'utf8');
  document.body.innerHTML = html;
  
  assert(checkActiveControls('teams') === true, 'Active controls not found in Teams active call');
});

let passed = 0;
let failed = 0;
console.log('Running custom Happy-DOM Meeting Detection tests (ESM)...');
for (const t of tests) {
  try {
    t.fn();
    console.log(`[PASS] ${t.name}`);
    passed++;
  } catch (err) {
    console.error(`[FAIL] ${t.name}`);
    console.error(err);
    failed++;
  }
}
console.log(`\nTests results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
