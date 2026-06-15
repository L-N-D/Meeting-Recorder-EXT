<template>
  <div class="fixed inset-0 z-[999999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 font-sans text-slate-800">
    <div class="w-full max-w-md overflow-hidden rounded-2xl bg-white/90 shadow-2xl ring-1 ring-black/5 backdrop-blur-md transition-all scale-100 flex flex-col">
      <!-- Header -->
      <div class="bg-gradient-to-r from-blue-600 to-indigo-600 p-6 text-white flex items-center gap-3">
        <div class="flex h-10 w-10 items-center justify-center rounded-xl bg-white/20 text-white backdrop-blur">
          <svg class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" />
          </svg>
        </div>
        <div>
          <h3 class="text-lg font-semibold tracking-wide">Meeting Detected</h3>
          <p class="text-xs text-blue-100 font-light">AI Data Collection Platform</p>
        </div>
      </div>

      <!-- Body -->
      <div class="p-6 flex-grow space-y-4">
        <p class="text-sm text-slate-600 leading-relaxed">
          We detected an active meeting session on <span class="font-medium text-slate-900">{{ platformName }}</span>.
          Would you like to start capturing the audio and video feed for secure AI analysis?
        </p>

        <div class="rounded-xl bg-slate-50 p-4 ring-1 ring-slate-100 flex items-start gap-3">
          <svg class="h-5 w-5 text-indigo-500 mt-0.5 animate-pulse" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.57-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
          </svg>
          <div class="text-xs text-slate-500 space-y-1">
            <p class="font-medium text-slate-700">Privacy & Performance Safeguards</p>
            <p>Continuous recording writes to IndexedDB in 5-second chunks. Relies on zero heap-accumulation stream piping.</p>
          </div>
        </div>
      </div>

      <!-- Footer -->
      <div class="bg-slate-50 px-6 py-4 flex items-center justify-end gap-3 border-t border-slate-100">
        <button
          @click="$emit('dismiss')"
          class="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-xl transition"
        >
          Dismiss
        </button>
        <button
          @click="$emit('start')"
          class="px-5 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 shadow-md shadow-blue-500/20 active:scale-95 rounded-xl transition"
        >
          Start Recording
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{
  platform: 'meet' | 'teams';
}>();

defineEmits<{
  (e: 'start'): void;
  (e: 'dismiss'): void;
}>();

const platformName = computed(() => {
  return props.platform === 'meet' ? 'Google Meet' : 'Microsoft Teams';
});
</script>
