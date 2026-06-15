<template>
  <div :class="['inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-all duration-200', config.classes]">
    <component :is="config.icon" :class="['h-3.5 w-3.5', config.iconClasses]" />
    <span>{{ config.label }}</span>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { RecorderStatus } from '../src/logger';
import { 
  Circle, 
  Loader2, 
  CheckCircle2, 
  ShieldCheck, 
  AlertTriangle,
  Upload,
  VideoOff,
  Video
} from 'lucide-vue-next';

const props = defineProps<{
  status: RecorderStatus;
}>();

const config = computed(() => {
  switch (props.status) {
    case RecorderStatus.SCANNING:
      return {
        label: 'Scanning...',
        icon: Loader2,
        iconClasses: 'animate-spin text-indigo-600 dark:text-indigo-400',
        classes: 'bg-indigo-50 border-indigo-100 text-indigo-700 dark:bg-indigo-950/20 dark:border-indigo-500/20 dark:text-indigo-400'
      };
    case RecorderStatus.MEETING_DETECTED:
      return {
        label: 'Meeting Detected',
        icon: Video,
        iconClasses: 'text-emerald-600 dark:text-emerald-400',
        classes: 'bg-emerald-50 border-emerald-100 text-emerald-700 dark:bg-emerald-950/20 dark:border-emerald-500/20 dark:text-emerald-400'
      };
    case RecorderStatus.REQUESTING_PERMISSION:
      return {
        label: 'Requesting Permission',
        icon: ShieldCheck,
        iconClasses: 'text-amber-600 dark:text-amber-400',
        classes: 'bg-amber-50 border-amber-100 text-amber-700 dark:bg-amber-950/20 dark:border-amber-500/20 dark:text-amber-400'
      };
    case RecorderStatus.PERMISSION_DENIED:
      return {
        label: 'Permission Denied',
        icon: AlertTriangle,
        iconClasses: 'text-red-600 dark:text-red-400',
        classes: 'bg-red-50 border-red-100 text-red-700 dark:bg-red-950/20 dark:border-red-500/20 dark:text-red-400'
      };
    case RecorderStatus.PREPARING:
      return {
        label: 'Preparing...',
        icon: Loader2,
        iconClasses: 'animate-spin text-slate-600 dark:text-slate-400',
        classes: 'bg-slate-100 border-slate-200 text-slate-700 dark:bg-slate-900/50 dark:border-slate-800 dark:text-slate-400'
      };
    case RecorderStatus.RECORDING:
      return {
        label: 'Recording Active',
        icon: Circle,
        iconClasses: 'fill-red-600 text-red-600 animate-pulse',
        classes: 'bg-red-50 border-red-100 text-red-700 dark:bg-red-950/20 dark:border-red-500/20 dark:text-red-400'
      };
    case RecorderStatus.SAVING:
      return {
        label: 'Saving Recording...',
        icon: Upload,
        iconClasses: 'text-cyan-600 dark:text-cyan-400',
        classes: 'bg-cyan-50 border-cyan-100 text-cyan-700 dark:bg-cyan-950/20 dark:border-cyan-500/20 dark:text-cyan-400'
      };
    case RecorderStatus.COMPLETED:
      return {
        label: 'Completed',
        icon: CheckCircle2,
        iconClasses: 'text-emerald-600 dark:text-emerald-400',
        classes: 'bg-emerald-50 border-emerald-100 text-emerald-700 dark:bg-emerald-950/20 dark:border-emerald-500/20 dark:text-emerald-400'
      };
    case RecorderStatus.FAILED:
      return {
        label: 'Failed',
        icon: AlertTriangle,
        iconClasses: 'text-red-600 dark:text-red-400',
        classes: 'bg-red-50 border-red-100 text-red-700 dark:bg-red-950/20 dark:border-red-500/20 dark:text-red-400'
      };
    case RecorderStatus.MEETING_ENDED:
      return {
        label: 'Meeting Ended',
        icon: VideoOff,
        iconClasses: 'text-slate-500 dark:text-slate-400',
        classes: 'bg-slate-100 border-slate-200 text-slate-600 dark:bg-slate-900/50 dark:border-slate-800 dark:text-slate-400'
      };
    case RecorderStatus.IDLE:
    default:
      return {
        label: 'Ready',
        icon: Circle,
        iconClasses: 'text-slate-400 dark:text-slate-500',
        classes: 'bg-slate-100 border-slate-200 text-slate-600 dark:bg-slate-900/50 dark:border-slate-800 dark:text-slate-400'
      };
  }
});
</script>
