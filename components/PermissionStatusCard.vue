<template>
  <div class="bg-gradient-to-br from-white to-slate-50 dark:from-slate-900 dark:to-indigo-950/20 rounded-xl p-4 border border-slate-200 dark:border-indigo-500/20 shadow-md relative overflow-hidden space-y-4">
    <div class="absolute top-0 right-0 h-16 w-16 bg-indigo-500/5 rounded-full blur-xl"></div>
    
    <div class="flex items-center gap-3 relative z-10">
      <div :class="['h-11 w-11 rounded-lg flex items-center justify-center flex-shrink-0 border', 
        status === RecorderStatus.REQUESTING_PERMISSION 
          ? 'bg-indigo-50 dark:bg-indigo-600/10 border-indigo-100 dark:border-indigo-500/30' 
          : 'bg-red-50 dark:bg-red-600/10 border-red-100 dark:border-red-500/30'
      ]">
        <ShieldCheck v-if="status === RecorderStatus.REQUESTING_PERMISSION" class="h-6 w-6 text-indigo-600 dark:text-indigo-400" />
        <AlertTriangle v-else class="h-6 w-6 text-red-600 dark:text-red-400" />
      </div>
      
      <div class="space-y-0.5">
        <h4 class="text-xs font-bold text-slate-800 dark:text-slate-105 uppercase tracking-wide">
          {{ status === RecorderStatus.REQUESTING_PERMISSION ? 'Awaiting Permissions' : 'Permissions Denied' }}
        </h4>
        <p class="text-[11px] text-slate-500 dark:text-slate-400 leading-normal max-w-[240px]">
          {{ status === RecorderStatus.REQUESTING_PERMISSION 
            ? 'Please approve the browser dialog requests to record tab video and audio.' 
            : 'Capture cannot start because microphone or screen permissions were denied.' 
          }}
        </p>
      </div>
    </div>

    <!-- Details or Instructions -->
    <div v-if="status === RecorderStatus.REQUESTING_PERMISSION" class="bg-indigo-50/50 dark:bg-indigo-950/20 p-2.5 rounded-lg border border-indigo-100/50 dark:border-indigo-500/10 flex items-start gap-2 text-[10px] text-indigo-700 dark:text-indigo-300 relative z-10 leading-relaxed">
      <Loader2 class="h-4 w-4 animate-spin text-indigo-600 dark:text-indigo-400 flex-shrink-0 mt-0.5" />
      <div>
        <span class="font-bold">Action Required:</span> Select the tab/screen in the system sharing dialog and check "Share tab audio" (if available).
      </div>
    </div>
    <div v-else class="bg-red-50/50 dark:bg-red-950/20 p-2.5 rounded-lg border border-red-100/50 dark:border-red-500/10 text-[10px] text-red-700 dark:text-red-400 relative z-10 leading-relaxed">
      <span class="font-bold">To fix this:</span> Click the settings/lock icon in the URL bar, enable microphone permissions, and try again.
    </div>

    <!-- Actions -->
    <div v-if="status === RecorderStatus.PERMISSION_DENIED" class="flex gap-2 pt-1 border-t border-slate-150 dark:border-slate-850 relative z-10">
      <button 
        @click="$emit('retry')"
        class="flex-1 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-lg transition active:scale-[0.98] shadow-sm flex items-center justify-center gap-1"
      >
        <RefreshCw class="h-3 w-3" />
        Retry Request
      </button>
      <button 
        @click="$emit('dismiss')"
        class="flex-1 py-1.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-xs font-semibold rounded-lg border border-slate-200 dark:border-slate-700 transition active:scale-[0.98]"
      >
        Dismiss
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { RecorderStatus } from '../src/logger';
import { 
  ShieldCheck, 
  AlertTriangle, 
  Loader2, 
  RefreshCw 
} from 'lucide-vue-next';

defineProps<{
  status: RecorderStatus;
}>();

defineEmits<{
  (e: 'retry'): void;
  (e: 'dismiss'): void;
  (e: 'dismiss'): void;
}>();
</script>
