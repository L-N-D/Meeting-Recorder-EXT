<template>
  <div class="space-y-3">
    <div class="flex items-center justify-between">
      <span class="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
        Recent Activity
      </span>
      <button 
        v-if="feed.length > 0"
        @click="$emit('clear')"
        class="text-[9px] font-semibold text-slate-400 dark:text-slate-500 hover:text-red-500 dark:hover:text-red-400 transition-colors bg-transparent border-0 cursor-pointer flex items-center gap-1"
      >
        <Trash2 class="h-3 w-3" />
        Clear
      </button>
    </div>

    <!-- Empty state -->
    <div 
      v-if="feed.length === 0" 
      class="text-slate-400 dark:text-slate-500 text-center py-6 text-[10px] border border-dashed border-slate-200 dark:border-slate-800 rounded-xl"
    >
      No activity events logged yet.
    </div>

    <!-- Timeline feed list -->
    <div v-else class="relative border-l border-slate-200 dark:border-slate-800 pl-4 ml-2 space-y-3 text-[11px] leading-relaxed max-h-[140px] overflow-y-auto pr-1">
      <div 
        v-for="(event, idx) in feed" 
        :key="idx" 
        class="relative transition-all duration-200 hover:text-slate-900 dark:hover:text-slate-100"
      >
        <!-- Timeline dot marker -->
        <span class="absolute -left-[20.5px] top-1.5 h-1.5 w-1.5 rounded-full border bg-white dark:bg-slate-950 border-indigo-500 dark:border-indigo-400"></span>
        
        <div class="flex items-start justify-between gap-2">
          <span class="text-slate-650 dark:text-slate-305 font-medium leading-snug select-text">{{ event.message }}</span>
          <span class="text-[9px] text-slate-400 dark:text-slate-500 font-mono flex-shrink-0 mt-0.5">{{ event.timestamp }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ActivityEvent } from '../src/logger';
import { Trash2 } from 'lucide-vue-next';

defineProps<{
  feed: ActivityEvent[];
}>();

defineEmits<{
  (e: 'clear'): void;
}>();
</script>
