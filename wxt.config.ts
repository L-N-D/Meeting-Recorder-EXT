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
    ],
    host_permissions: ['<all_urls>'],
  },
});
