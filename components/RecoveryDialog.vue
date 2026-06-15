<template>
  <div v-if="isOpen" class="fixed inset-0 z-[999999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 font-sans text-slate-800" @mousedown.stop>
    <div class="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-black/5 flex flex-col">
      <!-- Header -->
      <div class="bg-amber-600 p-6 text-white flex items-center gap-3">
        <div class="flex h-10 w-10 items-center justify-center rounded-xl bg-white/20 text-white backdrop-blur">
          <svg class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        </div>
        <div>
          <h3 class="text-lg font-semibold tracking-wide">Interrupted Recording Recovered</h3>
          <p class="text-xs text-amber-100 font-light">Local Storage / Crash Safe Recovery</p>
        </div>
      </div>

      <!-- Body -->
      <div class="p-6 space-y-4 max-h-[300px] overflow-y-auto">
        <p class="text-sm text-slate-600 leading-relaxed">
          The platform detected an interrupted session that was not fully uploaded to the server (e.g. due to browser crash, tab refresh, or network drop).
        </p>

        <div v-for="session in brokenSessions" :key="session.sessionId" class="p-4 border border-slate-200 rounded-xl space-y-3 bg-slate-50">
          <div class="flex justify-between items-start">
            <div>
              <p class="text-xs font-semibold text-slate-400 uppercase tracking-wider">Session ID</p>
              <p class="text-xs font-mono font-medium text-slate-700 break-all">{{ session.sessionId }}</p>
            </div>
            <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-800">
              Recovered
            </span>
          </div>

          <div class="grid grid-cols-2 gap-2 text-xs text-slate-500">
            <div>
              <span class="font-medium text-slate-700">Platform:</span> {{ session.platform === 'meet' ? 'Google Meet' : 'MS Teams' }}
            </div>
            <div>
              <span class="font-medium text-slate-700">Date:</span> {{ formatDate(session.startedAt) }}
            </div>
          </div>
          
          <div class="flex justify-end gap-2 pt-1 border-t border-slate-200/50 mt-2">
            <button 
              @click="exportSession(session.sessionId)"
              class="px-2.5 py-1.5 border border-slate-300 hover:bg-slate-100 text-slate-700 text-xs font-semibold rounded-lg transition"
            >
              Export Locally
            </button>
            <button 
              @click="resumeUpload(session.sessionId)"
              class="px-2.5 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded-lg shadow transition"
            >
              Resume Sync
            </button>
            <button 
              @click="deleteSession(session.sessionId)"
              class="px-2.5 py-1.5 hover:bg-red-50 text-red-600 text-xs font-semibold rounded-lg transition"
            >
              Discard
            </button>
          </div>
        </div>
      </div>

      <!-- Footer -->
      <div class="bg-slate-50 px-6 py-4 flex items-center justify-end border-t border-slate-100">
        <button
          @click="close"
          class="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-900 rounded-xl transition"
        >
          Close
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';

defineProps<{
  isOpen: boolean;
  brokenSessions: Array<{
    sessionId: string;
    platform: 'meet' | 'teams';
    startedAt: string;
  }>;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'resume', sessionId: string): void;
  (e: 'export', sessionId: string): void;
  (e: 'delete', sessionId: string): void;
}>();

function formatDate(iso: string) {
  if (!iso) return 'N/A';
  return new Date(iso).toLocaleString();
}

function resumeUpload(id: string) {
  emit('resume', id);
}

function exportSession(id: string) {
  emit('export', id);
}

function deleteSession(id: string) {
  emit('delete', id);
}

function close() {
  emit('close');
}
</script>
