import { defineConfig } from 'wxt';

export default defineConfig({
  outDir: 'dist',
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'EXT Recorder',
    description: 'Screen, tab and application recorder with native Linux audio mirror support.',
    version: '2.2.0',
    // Fixed public key → deterministic extension id
    // (plmehkdmfenfighdnboaknnolkpngdpb) so the native messaging host's
    // allowed_origins stays valid across reloads. See native-helper/.
    key: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEApvlbNFF18rXPN4FL4gmIe2uaamiCwJ/aphXAY1OSZYmmMgPEOPdrgcLo30KS9B1tmR7aX47nYLPbhHjZZ0/TDJ72vkW2koeqYCR7DzW3qPSfpunYqPLeUwJMOK8pB6dpXgNJCNZCB8e5vfqX+OOBBjlS5z6FShDJCiKIlQbUCup2D6fWohuEbml1RZ3V6joD2GOJyzBIigX2iTOPLZvApUBng7GpSJEOzXsr0lo+NH6dC7BbqgIyYZbAGCNezlALuKNm3QIo42gtF+16aXxyNnOAyB5NObmG7eFCHSCdduAVrj1pnc5fd/nwTu5hJ6VGVWA4xnOZl5Y4mXkGp1nJvwIDAQAB',
    permissions: [
      'offscreen',
      'desktopCapture',
      'tabCapture',
      'tabs',
      'downloads',
      'activeTab',
      'scripting',
      'storage',
      'contextMenus',
      'nativeMessaging',
      'sidePanel',
    ],
    host_permissions: ['<all_urls>'],
    // Side panel replaces the popup. The toolbar icon click opens the panel
    // (configured in background.ts via chrome.sidePanel.setPanelBehavior).
    // No default_popup so the action button is purely a panel toggle.
    action: {
      default_title: 'EXT Recorder',
    },
    side_panel: {
      default_path: 'sidepanel.html',
    },
    commands: {
      'arm-focus-tab': {
        suggested_key: {
          default: 'Alt+Shift+F',
          mac: 'Alt+Shift+F',
        },
        description: 'Add the current tab to the Focus recording',
      },
    },
  },
});
