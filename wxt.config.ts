import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-vue'],
  outDir: 'dist',
  manifest: {
    name: 'Meeting Data Collection Agent',
    version: '1.0.0',
    description: 'Production-ready meeting data collection agent for AI processing pipelines.',
    permissions: [
      'storage',
      'offscreen',
      'tabs',
      'activeTab'
    ],
    host_permissions: [
      'https://meet.google.com/*',
      'https://teams.microsoft.com/*',
      'https://teams.live.com/*'
    ]
  }
});
