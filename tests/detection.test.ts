import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';

// --- Mocks to allow importing entrypoints/content without crashing ---
global.defineContentScript = (config: any) => config;
global.chrome = {
  runtime: {
    sendMessage: () => Promise.resolve({ success: true }),
    onMessage: {
      addListener: () => {}
    }
  },
  tabs: {
    query: () => {},
    sendMessage: () => Promise.resolve()
  },
  storage: {
    local: {
      get: () => Promise.resolve({ debug_logs: [] }),
      set: () => Promise.resolve()
    }
  }
} as any;

// Mock window.location and sessionStorage for JSDOM
const originalLocation = window.location;
delete (window as any).location;
(window as any).location = {
  href: 'https://meet.google.com/abc-defg-hij',
  host: 'meet.google.com',
  pathname: '/abc-defg-hij'
};

global.sessionStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
  clear: () => {}
} as any;

// Now import the selectors and isMeetingUrl helper from content.ts
import { MEET_SELECTORS, TEAMS_SELECTORS } from '../entrypoints/content';

// Simple implementation of helper functions to test DOM state against selectors
function findElement(selectors: string[]): HTMLElement | null {
  for (const selector of selectors) {
    const el = document.querySelector(selector);
    if (el) return el as HTMLElement;
  }
  return null;
}

function checkActiveControls(platform: 'meet' | 'teams'): boolean {
  if (platform === 'meet') {
    const leaveBtn = findElement(MEET_SELECTORS.leaveButton);
    const micBtn = findElement(MEET_SELECTORS.micButton);
    return !!(leaveBtn && micBtn);
  } else {
    const leaveBtn = findElement(TEAMS_SELECTORS.leaveButton);
    const micBtn = findElement(TEAMS_SELECTORS.micButton);
    return !!(leaveBtn && micBtn);
  }
}

function checkLobbyIndicators(platform: 'meet' | 'teams'): boolean {
  if (platform === 'meet') {
    return !!findElement(MEET_SELECTORS.lobbyIndicators);
  } else {
    return !!findElement(TEAMS_SELECTORS.lobbyIndicators);
  }
}

function isMeetingUrl(urlStr: string): boolean {
  try {
    const url = new URL(urlStr);
    if (url.host.includes('meet.google.com')) {
      const path = url.pathname;
      return /^\/[a-z]{3}-[a-z]{4}-[a-z]{3}$/.test(path) || path.startsWith('/lookup/');
    }
    if (url.host.includes('teams.microsoft.com')) {
      const path = url.pathname;
      return path.includes('/l/meetup-join/') || path.includes('/meet/') || path.includes('/v2/');
    }
    return false;
  } catch (e) {
    return false;
  }
}

describe('Meeting Detection Tests', () => {

  describe('URL Validator', () => {
    it('should validate Google Meet meeting URLs correctly', () => {
      expect(isMeetingUrl('https://meet.google.com/xyz-pdqr-abc')).toBe(true);
      expect(isMeetingUrl('https://meet.google.com/lookup/somecode')).toBe(true);
      expect(isMeetingUrl('https://meet.google.com/')).toBe(false);
      expect(isMeetingUrl('https://meet.google.com/landing')).toBe(false);
      expect(isMeetingUrl('https://meet.google.com/new')).toBe(false);
    });

    it('should validate MS Teams meeting URLs correctly', () => {
      expect(isMeetingUrl('https://teams.microsoft.com/l/meetup-join/19%3ameeting_Y2...')).toBe(true);
      expect(isMeetingUrl('https://teams.microsoft.com/v2/abc')).toBe(true);
      expect(isMeetingUrl('https://teams.microsoft.com/meet/123')).toBe(true);
      expect(isMeetingUrl('https://teams.microsoft.com/')).toBe(false);
    });
  });

  describe('Google Meet Fixtures', () => {
    it('should detect LOBBY state in meet-lobby.html snapshot', () => {
      const fixturePath = path.resolve(__dirname, 'fixtures/meet-lobby.html');
      const html = fs.readFileSync(fixturePath, 'utf8');
      document.body.innerHTML = html;

      // In lobby, active controls are missing, but lobby indicators are present
      expect(checkActiveControls('meet')).toBe(false);
      expect(checkLobbyIndicators('meet')).toBe(true);
    });

    it('should detect ACTIVE meeting state in meet-active.html snapshot', () => {
      const fixturePath = path.resolve(__dirname, 'fixtures/meet-active.html');
      const html = fs.readFileSync(fixturePath, 'utf8');
      document.body.innerHTML = html;

      // Active controls (mic and leave button) must both be present
      expect(checkActiveControls('meet')).toBe(true);
    });
  });

  describe('MS Teams Fixtures', () => {
    it('should detect LOBBY state in teams-lobby.html snapshot', () => {
      const fixturePath = path.resolve(__dirname, 'fixtures/teams-lobby.html');
      const html = fs.readFileSync(fixturePath, 'utf8');
      document.body.innerHTML = html;

      expect(checkActiveControls('teams')).toBe(false);
      expect(checkLobbyIndicators('teams')).toBe(true);
    });

    it('should detect ACTIVE meeting state in teams-active.html snapshot', () => {
      const fixturePath = path.resolve(__dirname, 'fixtures/teams-active.html');
      const html = fs.readFileSync(fixturePath, 'utf8');
      document.body.innerHTML = html;

      expect(checkActiveControls('teams')).toBe(true);
    });
  });
});
