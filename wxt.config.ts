import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  outDir: 'dist',
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'Screen Recorder',
    description: 'A simple Chrome Extension for screen recording and audio mixing.',
    version: '1.0.0',
    permissions: [
      'offscreen',
      'desktopCapture',
      'downloads',
      'activeTab'
    ]
  }
});
