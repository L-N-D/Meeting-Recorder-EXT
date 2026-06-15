<template>
  <div class="flex-grow flex flex-col justify-center items-center text-center py-6 px-4 space-y-4">
    <div class="h-14 w-14 bg-gradient-to-tr from-indigo-500/10 to-indigo-600/20 rounded-2xl flex items-center justify-center ring-1 ring-indigo-500/20 shadow-inner dark:from-indigo-400/10 dark:to-indigo-500/20">
      <VideoOff class="h-6 w-6 text-indigo-500 dark:text-indigo-400" />
    </div>
    <div class="space-y-1">
      <h3 class="text-xs font-bold text-slate-800 dark:text-slate-200 tracking-wide uppercase">No active meeting detected</h3>
      <p class="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed max-w-[280px] mx-auto">
        Open Google Meet or Microsoft Teams in a browser tab to start recording.
      </p>
    </div>
    <div class="flex gap-2.5 pt-1">
      <a 
        href="https://meet.google.com" 
        target="_blank" 
        class="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-900 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800 rounded-lg text-[11px] font-semibold text-slate-700 dark:text-slate-350 hover:text-slate-900 dark:hover:text-white transition active:scale-[0.98]"
      >
        <span class="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
        Google Meet
      </a>
      <a 
        href="https://teams.microsoft.com" 
        target="_blank" 
        class="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-900 dark:hover:bg-slate-805 border border-slate-200 dark:border-slate-800 rounded-lg text-[11px] font-semibold text-slate-700 dark:text-slate-350 hover:text-slate-900 dark:hover:text-white transition active:scale-[0.98]"
      >
        <span class="h-1.5 w-1.5 rounded-full bg-blue-500 animate-pulse"></span>
        MS Teams
      </a>
    </div>
  </div>
</template>

<script setup lang="ts">
import { VideoOff } from 'lucide-vue-next';
</script>
