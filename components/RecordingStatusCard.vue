<template>
  <div class="bg-gradient-to-br from-white to-slate-50 dark:from-slate-900 dark:to-indigo-950/20 rounded-xl p-4 border border-slate-200 dark:border-indigo-500/20 shadow-md relative overflow-hidden space-y-4">
    <div class="absolute top-0 right-0 h-20 w-20 bg-indigo-500/5 rounded-full blur-xl"></div>
    
    <!-- Top info -->
    <div class="flex justify-between items-center relative z-10">
      <div class="flex items-center gap-1.5">
        <span class="relative flex h-2 w-2" v-if="status === RecorderStatus.RECORDING">
          <span class="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 bg-red-400"></span>
          <span class="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
        </span>
        <span class="relative flex h-2 w-2" v-else-if="status === RecorderStatus.PAUSED">
          <span class="relative inline-flex rounded-full h-2 w-2 bg-yellow-500"></span>
        </span>
        <span class="text-[10px] font-bold tracking-wider uppercase text-slate-500 dark:text-indigo-400">
          {{ cardTitle }}
        </span>
      </div>
      <span :class="['text-[9px] font-bold px-2 py-0.5 border rounded uppercase tracking-wide', platform === 'meet' ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/20' : 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-500/10 dark:text-blue-400 dark:border-blue-500/20']">
        {{ platform === 'meet' ? 'Google Meet' : 'MS Teams' }}
      </span>
    </div>

    <!-- Main Content Area -->
    <div class="flex items-center justify-between py-1 relative z-10">
      <!-- Recording / Paused Time Display -->
      <div v-if="[RecorderStatus.RECORDING, RecorderStatus.PAUSED].includes(status)" class="flex flex-col">
        <RecordingTimer :duration="duration" class="text-4xl text-slate-800 dark:text-slate-100 font-mono font-semibold" />
      </div>

      <!-- Saving State -->
      <div v-else-if="status === RecorderStatus.SAVING" class="w-full space-y-2">
        <div class="flex justify-between text-[11px] font-medium text-slate-600 dark:text-slate-400">
          <span class="flex items-center gap-1.5 font-medium">
            <Loader2 class="h-3.5 w-3.5 animate-spin text-cyan-500" />
            Uploading local buffer...
          </span>
          <span class="font-mono text-xs">{{ uploaded }}/{{ total }} chunks</span>
        </div>
        <div class="h-2 bg-slate-150 dark:bg-slate-950 rounded-full overflow-hidden border border-slate-200 dark:border-slate-800">
          <div 
            class="h-full bg-cyan-500 dark:bg-cyan-450 transition-all duration-350"
            :style="{ width: percent + '%' }"
          ></div>
        </div>
      </div>

      <!-- Completed State -->
      <div v-else-if="status === RecorderStatus.COMPLETED" class="w-full flex items-center gap-3">
        <div class="h-10 w-10 rounded-lg bg-emerald-50 dark:bg-emerald-500/15 border border-emerald-100 dark:border-emerald-500/30 flex items-center justify-center flex-shrink-0">
          <CheckCircle2 class="h-5.5 w-5.5 text-emerald-550 dark:text-emerald-450" />
        </div>
        <div class="space-y-0.5">
          <h5 class="text-xs font-semibold text-slate-800 dark:text-slate-150">Recording Saved Successfully</h5>
          <p class="text-[10px] text-slate-500 dark:text-slate-400 font-mono">Duration: {{ formattedDuration }}</p>
        </div>
      </div>

      <!-- Failed State -->
      <div v-else-if="status === RecorderStatus.FAILED" class="w-full flex items-center gap-3">
        <div class="h-10 w-10 rounded-lg bg-red-50 dark:bg-red-500/15 border border-red-100 dark:border-red-500/30 flex items-center justify-center flex-shrink-0">
          <AlertTriangle class="h-5.5 w-5.5 text-red-550 dark:text-red-450" />
        </div>
        <div class="space-y-0.5">
          <h5 class="text-xs font-semibold text-slate-800 dark:text-slate-150">Recording Failed</h5>
          <p class="text-[10px] text-red-650 dark:text-red-400 max-w-[260px] truncate leading-relaxed">
            {{ errorMsg || 'An unknown error occurred.' }}
          </p>
        </div>
      </div>

      <!-- Sidebar details for active recordings -->
      <div v-if="[RecorderStatus.RECORDING, RecorderStatus.PAUSED].includes(status)" class="text-right text-[10px] text-slate-500 dark:text-slate-450 space-y-1">
        <div class="flex items-center justify-end gap-1.5">
          <span>Audio:</span>
          <span :class="['font-bold px-1.5 py-0.2 rounded text-[9px]', hasAudio ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400' : 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400']">
            {{ hasAudio ? 'ACTIVE' : 'MISSING' }}
          </span>
        </div>
        <p class="font-mono text-[9px] text-slate-400 dark:text-slate-500">ID: ...{{ sessionId?.slice(-8) }}</p>
      </div>
    </div>

    <!-- Bottom Controls Area -->
    <div class="flex items-center gap-2 border-t border-slate-100 dark:border-slate-800/80 pt-3 relative z-10">
      <!-- Recording Active state controls -->
      <template v-if="status === RecorderStatus.RECORDING">
        <button 
          @click="$emit('pause')"
          class="flex-1 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold transition border border-slate-205 dark:border-slate-700/50 active:scale-[0.98] flex items-center justify-center gap-1.5"
        >
          <Pause class="h-3.5 w-3.5" />
          Pause
        </button>
        <button 
          @click="$emit('stop')"
          class="flex-1 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 text-white text-xs font-semibold transition shadow-sm active:scale-[0.98] flex items-center justify-center gap-1.5"
        >
          <Square class="h-3.5 w-3.5 fill-white text-white" />
          Stop Capture
        </button>
      </template>

      <!-- Recording Paused state controls -->
      <template v-else-if="status === RecorderStatus.PAUSED">
        <button 
          @click="$emit('resume')"
          class="flex-1 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition shadow-sm active:scale-[0.98] flex items-center justify-center gap-1.5"
        >
          <Play class="h-3.5 w-3.5 fill-white text-white" />
          Resume
        </button>
        <button 
          @click="$emit('stop')"
          class="flex-1 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 text-white text-xs font-semibold transition shadow-sm active:scale-[0.98] flex items-center justify-center gap-1.5"
        >
          <Square class="h-3.5 w-3.5 fill-white text-white" />
          Stop Capture
        </button>
      </template>

      <!-- Completed / Failed Action Buttons -->
      <template v-else-if="status === RecorderStatus.COMPLETED">
        <button 
          @click="exportWebM"
          class="flex-1 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-750 text-slate-700 dark:text-slate-200 text-xs font-semibold transition border border-slate-200 dark:border-slate-700 active:scale-[0.98] flex items-center justify-center gap-1.5"
        >
          <Download class="h-3.5 w-3.5" />
          Export WebM
        </button>
        <button 
          @click="$emit('dismiss')"
          class="flex-1 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition shadow-sm active:scale-[0.98] flex items-center justify-center gap-1"
        >
          Dismiss
        </button>
      </template>

      <template v-else-if="status === RecorderStatus.FAILED">
        <button 
          @click="$emit('retry')"
          class="flex-1 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition shadow-sm active:scale-[0.98] flex items-center justify-center gap-1"
        >
          Retry Capture
        </button>
        <button 
          @click="$emit('dismiss')"
          class="flex-1 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-350 text-xs font-semibold border border-slate-200 dark:border-slate-700 transition active:scale-[0.98]"
        >
          Dismiss
        </button>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { RecorderStatus } from '../src/logger';
import RecordingTimer from './RecordingTimer.vue';
import { 
  Pause, 
  Play, 
  Square, 
  CheckCircle2, 
  AlertTriangle, 
  Loader2,
  Download
} from 'lucide-vue-next';

const props = defineProps<{
  status: RecorderStatus;
  duration: number;
  platform: 'meet' | 'teams';
  hasAudio: boolean;
  uploaded: number;
  total: number;
  errorMsg?: string;
  sessionId: string;
}>();

const emit = defineEmits<{
  (e: 'pause'): void;
  (e: 'resume'): void;
  (e: 'stop'): void;
  (e: 'dismiss'): void;
  (e: 'retry'): void;
  (e: 'export', sessionId: string): void;
}>();

const cardTitle = computed(() => {
  switch (props.status) {
    case RecorderStatus.RECORDING:
      return 'RECORDING RUNNING';
    case RecorderStatus.PAUSED:
      return 'RECORDING PAUSED';
    case RecorderStatus.SAVING:
      return 'SYNCHRONIZING';
    case RecorderStatus.COMPLETED:
      return 'CAPTURE COMPLETED';
    case RecorderStatus.FAILED:
      return 'CAPTURE ERROR';
    default:
      return 'INGESTION ENGINE';
  }
});

const percent = computed(() => {
  if (props.total === 0) return 0;
  return Math.round((props.uploaded / props.total) * 100);
});

const formattedDuration = computed(() => {
  const hrs = Math.floor(props.duration / 3600);
  const mins = Math.floor((props.duration % 3600) / 60);
  const secs = props.duration % 60;
  return [
    hrs.toString().padStart(2, '0'),
    mins.toString().padStart(2, '0'),
    secs.toString().padStart(2, '0')
  ].join(':');
});

function exportWebM() {
  emit('export', props.sessionId);
}
</script>
