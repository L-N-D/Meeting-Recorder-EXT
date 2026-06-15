<template>
  <div class="bg-gradient-to-br from-indigo-50/50 to-white dark:from-slate-900 dark:to-indigo-950/20 rounded-xl p-4 border border-indigo-100 dark:border-indigo-500/20 shadow-sm relative overflow-hidden">
    <div class="absolute top-0 right-0 h-16 w-16 bg-indigo-500/5 rounded-full blur-xl"></div>
    
    <div class="flex items-start justify-between relative z-10">
      <div class="flex items-center gap-2.5">
        <div class="h-10 w-10 bg-indigo-100 dark:bg-indigo-600/20 border border-indigo-200 dark:border-indigo-500/30 rounded-lg flex items-center justify-center">
          <Video class="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
        </div>
        <div>
          <div class="flex items-center gap-1.5">
            <span class="text-[10px] font-bold tracking-wider uppercase text-indigo-600 dark:text-indigo-400">MEETING DETECTED</span>
          </div>
          <h4 class="text-xs font-semibold text-slate-800 dark:text-slate-200 mt-0.5 max-w-[180px] truncate">
            {{ title || 'Active Discussion' }}
          </h4>
        </div>
      </div>
      
      <span :class="['text-[9px] font-bold px-2 py-0.5 border rounded uppercase tracking-wide', platform === 'meet' ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/20' : 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-500/10 dark:text-blue-400 dark:border-blue-500/20']">
        {{ platform === 'meet' ? 'Google Meet' : 'MS Teams' }}
      </span>
    </div>

    <div class="mt-4 flex items-center justify-between border-t border-slate-100 dark:border-slate-800/80 pt-3 relative z-10">
      <div class="flex items-center gap-1 text-[10px] text-slate-500 dark:text-slate-400">
        <CheckCircle2 class="h-3.5 w-3.5 text-emerald-500" />
        <span>Ready to Record</span>
      </div>
      <button 
        @click="$emit('start')"
        class="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-semibold rounded-lg transition active:scale-[0.98] shadow-sm shadow-indigo-600/10 flex items-center gap-1"
      >
        <Play class="h-3 w-3 fill-white" />
        Start Capture
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Video, CheckCircle2, Play } from 'lucide-vue-next';

defineProps<{
  platform: 'meet' | 'teams';
  title?: string;
}>();

defineEmits<{
  (e: 'start'): void;
}>();
</script>
