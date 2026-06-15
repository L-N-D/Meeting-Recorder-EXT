<template>
  <div class="font-mono font-semibold tracking-wide select-none text-slate-800 dark:text-slate-100">
    {{ formatted }}
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{
  duration: number;
}>();

const formatted = computed(() => {
  const hrs = Math.floor(props.duration / 3600);
  const mins = Math.floor((props.duration % 3600) / 60);
  const secs = props.duration % 60;
  
  return [
    hrs.toString().padStart(2, '0'),
    mins.toString().padStart(2, '0'),
    secs.toString().padStart(2, '0')
  ].join(':');
});
</script>
