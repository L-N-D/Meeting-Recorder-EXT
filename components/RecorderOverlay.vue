<template>
  <div
    :style="{ left: x + 'px', top: y + 'px' }"
    class="fixed z-[999999] w-72 rounded-2xl bg-slate-900/95 text-white shadow-2xl ring-1 ring-white/10 backdrop-blur-md font-sans select-none overflow-hidden"
    @mousedown="onOverlayMouseDown"
  >
    <!-- Draggable Header Handle -->
    <div
      class="draggable-overlay px-4 py-2.5 bg-slate-800/80 border-b border-slate-700/50 flex items-center justify-between cursor-grab active:cursor-grabbing"
      @mousedown="startDrag"
    >
      <div class="flex items-center gap-2">
        <span class="relative flex h-2.5 w-2.5">
          <span :class="['animate-ping absolute inline-flex h-full w-full rounded-full opacity-75', isRecording ? 'bg-red-400' : 'bg-yellow-400']"></span>
          <span :class="['relative inline-flex rounded-full h-2.5 w-2.5', isRecording ? 'bg-red-500' : 'bg-yellow-500']"></span>
        </span>
        <span class="text-xs font-semibold uppercase tracking-wider text-slate-300">
          {{ statusText }}
        </span>
      </div>
      <div class="text-[10px] text-slate-400 font-mono tracking-tight bg-slate-950 px-2 py-0.5 rounded border border-slate-700/30">
        AI INGESTION
      </div>
    </div>

    <!-- Main Content -->
    <div class="p-4 space-y-3">
      <!-- Duration & Audio Status -->
      <div class="flex items-center justify-between">
        <div class="text-2xl font-semibold font-mono tracking-wider text-slate-100">
          {{ formattedDuration }}
        </div>
        
        <!-- Audio Detector Badge -->
        <div 
          :class="['flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-all duration-300', 
                   hasAudio ? 'bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/30' : 'bg-amber-500/20 text-amber-300 ring-1 ring-amber-500/30 animate-pulse']"
        >
          <span class="text-[10px]">{{ hasAudio ? '✓' : '⚠' }}</span>
          <span>{{ hasAudio ? 'Audio detected' : 'No audio' }}</span>
        </div>
      </div>

      <!-- Warning if No Audio -->
      <div v-if="!hasAudio" class="p-2 bg-amber-500/10 text-amber-200 border border-amber-500/20 rounded-lg text-[10px] leading-relaxed">
        <strong>Warning:</strong> Ensure "Share tab audio" is enabled in chrome prompt to capture meeting voice streams.
      </div>

      <!-- Upload Sync Progress -->
      <div class="space-y-1">
        <div class="flex justify-between text-[11px] text-slate-400">
          <span>Local Persisted Pipeline</span>
          <span class="font-mono">{{ uploadProgress }}</span>
        </div>
        <!-- Simple progress representation -->
        <div class="h-1 bg-slate-800 rounded-full overflow-hidden">
          <div 
            class="h-full bg-blue-500 transition-all duration-500" 
            :style="{ width: percentUploaded + '%' }"
          ></div>
        </div>
      </div>
    </div>

    <!-- Actions Panel -->
    <div class="bg-slate-950/50 border-t border-slate-800/80 px-4 py-3 flex items-center justify-between gap-3">
      <button
        v-if="isRecording"
        @click.stop="$emit('pause')"
        class="flex-1 py-1.5 px-3 rounded-lg text-xs font-medium text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 active:scale-95 transition"
      >
        Pause
      </button>
      <button
        v-else-if="status === 'paused'"
        @click.stop="$emit('resume')"
        class="flex-1 py-1.5 px-3 rounded-lg text-xs font-medium text-white bg-blue-600 hover:bg-blue-500 active:scale-95 transition"
      >
        Resume
      </button>

      <button
        @click.stop="$emit('stop')"
        class="flex-1 py-1.5 px-3 rounded-lg text-xs font-semibold text-white bg-red-600 hover:bg-red-500 shadow-lg shadow-red-600/10 active:scale-95 transition"
      >
        Stop
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';

const props = defineProps<{
  status: 'recording' | 'paused' | 'completed' | 'failed' | 'inactive';
  duration: number;
  hasAudio: boolean;
  uploadedChunks: number;
  totalChunks: number;
}>();

defineEmits<{
  (e: 'pause'): void;
  (e: 'resume'): void;
  (e: 'stop'): void;
}>();

// Floating coordinates
const x = ref(window.innerWidth - 304);
const y = ref(24);

let isDragging = false;
let dragStartX = 0;
let dragStartY = 0;

function startDrag(e: MouseEvent) {
  // Only drag on left click
  if (e.button !== 0) return;
  isDragging = true;
  dragStartX = e.clientX - x.value;
  dragStartY = e.clientY - y.value;
  
  document.addEventListener('mousemove', onDrag);
  document.addEventListener('mouseup', stopDrag);
  
  e.preventDefault();
}

function onDrag(e: MouseEvent) {
  if (!isDragging) return;
  
  // Calculate bounds to prevent dragging offscreen
  let newX = e.clientX - dragStartX;
  let newY = e.clientY - dragStartY;
  
  newX = Math.max(10, Math.min(window.innerWidth - 298, newX));
  newY = Math.max(10, Math.min(window.innerHeight - 180, newY));
  
  x.value = newX;
  y.value = newY;
}

function stopDrag() {
  isDragging = false;
  document.removeEventListener('mousemove', onDrag);
  document.removeEventListener('mouseup', stopDrag);
}

function onOverlayMouseDown(e: MouseEvent) {
  // Prevent meeting page interactions behind overlay
  e.stopPropagation();
}

// Format duration to HH:MM:SS
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

const isRecording = computed(() => props.status === 'recording');

const statusText = computed(() => {
  if (props.status === 'recording') return 'Recording';
  if (props.status === 'paused') return 'Paused';
  return props.status;
});

const uploadProgress = computed(() => {
  if (props.totalChunks === 0) return '0 chunks';
  return `Uploaded ${props.uploadedChunks}/${props.totalChunks}`;
});

const percentUploaded = computed(() => {
  if (props.totalChunks === 0) return 0;
  return Math.min(100, Math.round((props.uploadedChunks / props.totalChunks) * 100));
});

// Update float layout if window resizes
onMounted(() => {
  window.addEventListener('resize', () => {
    if (x.value > window.innerWidth - 304) {
      x.value = window.innerWidth - 304;
    }
    if (y.value > window.innerHeight - 180) {
      y.value = window.innerHeight - 180;
    }
  });
});
</script>
