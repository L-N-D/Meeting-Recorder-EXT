import { defineConfig } from 'wxt';

export default defineConfig({
  outDir: 'dist',
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'Screen Recorder',
    description: 'A Chrome Extension for screen recording with Focus 1-1 and audio mixing.',
    version: '2.0.0',
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
    ],
    host_permissions: ['<all_urls>'],
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
