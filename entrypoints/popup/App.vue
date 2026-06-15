<template>
  <div :class="[isDark ? 'dark bg-slate-950 text-slate-100' : 'bg-slate-50 text-slate-900', 'w-[380px] h-[530px] max-h-[530px] font-sans flex flex-col overflow-hidden select-none transition-colors duration-200']">
    <!-- Header -->
    <div class="bg-gradient-to-r from-slate-100 to-slate-200 dark:from-slate-900 dark:to-indigo-950/80 px-4 py-3 shadow-sm dark:shadow-lg border-b border-slate-200 dark:border-white/5 flex items-center justify-between flex-shrink-0">
      <div class="flex items-center gap-2.5">
        <div class="h-8 w-8 bg-indigo-600/10 dark:bg-indigo-600/20 border border-indigo-200 dark:border-indigo-500/30 rounded-lg flex items-center justify-center backdrop-blur">
          <Activity class="h-4.5 w-4.5 text-indigo-600 dark:text-indigo-400" />
        </div>
        <div>
          <h1 class="text-xs font-bold tracking-wide text-slate-800 dark:text-slate-100">Meeting Recorder</h1>
          <p class="text-[9px] text-indigo-600 dark:text-indigo-300/80 font-mono">AI Ingestion Pipeline</p>
        </div>
      </div>
      
      <!-- Right Side Controls -->
      <div class="flex items-center gap-2">
        <!-- Ingestion Server Health -->
        <div class="flex items-center gap-1 bg-slate-200 dark:bg-slate-900/80 px-2 py-0.5 rounded-full border border-slate-300 dark:border-white/5 text-[9px] font-mono">
          <span :class="['h-1.5 w-1.5 rounded-full', serverOnline ? 'bg-emerald-500 animate-pulse' : 'bg-red-500']"></span>
          <span class="text-slate-650 dark:text-slate-300 font-semibold">{{ serverOnline ? 'ONLINE' : 'OFFLINE' }}</span>
        </div>
        
        <!-- Theme Toggle -->
        <button 
          @click="toggleTheme" 
          class="p-1 rounded-lg bg-slate-200 dark:bg-slate-900 hover:bg-slate-300 dark:hover:bg-slate-850 text-slate-600 dark:text-slate-400 border border-slate-300 dark:border-white/5 transition active:scale-95"
          title="Toggle Theme"
        >
          <Sun v-if="isDark" class="h-3.5 w-3.5 text-indigo-400" />
          <Moon v-else class="h-3.5 w-3.5 text-slate-600" />
        </button>
      </div>
    </div>

    <!-- Tab Navigation Bar -->
    <div class="flex border-b border-slate-200 dark:border-slate-900 bg-slate-100/60 dark:bg-slate-900/30 px-3 py-1.5 gap-1 flex-shrink-0">
      <button 
        @click="currentTab = 'dashboard'"
        :class="['flex-1 py-1.5 text-[11px] font-semibold rounded-lg transition-all duration-200 flex items-center justify-center gap-1.5', currentTab === 'dashboard' ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/10' : 'text-slate-500 hover:text-slate-700 hover:bg-slate-200 dark:text-slate-400 dark:hover:text-slate-250 dark:hover:bg-slate-900/50']"
      >
        <LayoutDashboard class="h-3.5 w-3.5" />
        Dashboard
      </button>
      <button 
        @click="currentTab = 'library'"
        :class="['flex-1 py-1.5 text-[11px] font-semibold rounded-lg transition-all duration-200 flex items-center justify-center gap-1.5', currentTab === 'library' ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/10' : 'text-slate-500 hover:text-slate-700 hover:bg-slate-200 dark:text-slate-400 dark:hover:text-slate-250 dark:hover:bg-slate-900/50']"
      >
        <Library class="h-3.5 w-3.5" />
        Library
        <span v-if="pastSessions.length > 0" class="bg-slate-200 dark:bg-indigo-900/80 border border-slate-300 dark:border-indigo-400/30 text-slate-700 dark:text-white text-[9px] px-1.5 py-0.2 rounded-full font-mono font-bold leading-none">
          {{ pastSessions.length }}
        </span>
      </button>
      <button 
        @click="currentTab = 'diagnostics'"
        :class="['flex-1 py-1.5 text-[11px] font-semibold rounded-lg transition-all duration-200 flex items-center justify-center gap-1.5', currentTab === 'diagnostics' ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/10' : 'text-slate-500 hover:text-slate-700 hover:bg-slate-200 dark:text-slate-400 dark:hover:text-slate-250 dark:hover:bg-slate-900/50']"
      >
        <Terminal class="h-3.5 w-3.5" />
        Console
        <span v-if="logs.length > 0" class="bg-slate-200 dark:bg-slate-800 text-slate-650 dark:text-slate-300 text-[9px] px-1.5 py-0.2 rounded-full font-mono leading-none border border-slate-300 dark:border-slate-700">
          {{ logs.length }}
        </span>
      </button>
    </div>

    <!-- Scrollable Tab Content Container -->
    <div class="flex-grow p-4 overflow-y-auto bg-gradient-to-b from-white to-slate-50 dark:from-slate-950 dark:to-slate-900 flex flex-col justify-start">
      <!-- 1. Dashboard Tab View -->
      <div v-if="currentTab === 'dashboard'" class="space-y-4 flex flex-col justify-between flex-grow">
        <div class="space-y-4 flex-grow flex flex-col justify-start">
          <!-- Status Banner Indicator -->
          <div class="flex items-center justify-between">
            <span class="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">System State</span>
            <div class="flex items-center gap-2">
              <button 
                @click="scanActiveTab" 
                class="p-1 rounded-md text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-900 border border-transparent hover:border-slate-200 dark:hover:border-slate-800 transition active:scale-95" 
                title="Scan meeting tabs"
              >
                <RefreshCw :class="['h-3 w-3', scanning ? 'animate-spin' : '']" />
              </button>
              <StatusIndicator :status="recorderStatus" />
            </div>
          </div>

          <!-- Dynamic Main State Panel -->
          <!-- State: Idle -->
          <div v-if="recorderStatus === RecorderStatus.IDLE" class="flex-grow flex flex-col justify-center">
            <EmptyState />
          </div>

          <!-- State: Scanning / Detecting -->
          <div v-else-if="recorderStatus === RecorderStatus.SCANNING" class="flex-grow flex flex-col justify-center items-center py-8 space-y-3">
            <RefreshCw class="animate-spin h-8 w-8 text-indigo-500 dark:text-indigo-400" />
            <p class="text-xs text-slate-500 dark:text-slate-400 font-medium">Scanning for active meetings...</p>
          </div>

          <!-- State: Meeting Detected -->
          <div v-else-if="recorderStatus === RecorderStatus.MEETING_DETECTED && detectedMeeting" class="flex-grow flex flex-col justify-center">
            <MeetingStatusCard 
              :platform="detectedMeeting.platform"
              :title="detectedMeeting.title"
              @start="startRecordingFromPopup"
            />
          </div>

          <!-- State: Requesting Permission or Permission Denied -->
          <div v-else-if="[RecorderStatus.REQUESTING_PERMISSION, RecorderStatus.PERMISSION_DENIED].includes(recorderStatus)" class="flex-grow flex flex-col justify-center">
            <PermissionStatusCard 
              :status="recorderStatus"
              @retry="startRecordingFromPopup"
              @dismiss="dismissState"
            />
          </div>

          <!-- States: Preparing, Recording, Saving, Completed, Failed -->
          <div v-else class="flex-grow flex flex-col justify-center">
            <RecordingStatusCard 
              :status="recorderStatus"
              :duration="activeSession.duration"
              :platform="activeSession.platform"
              :hasAudio="activeSession.hasAudio"
              :uploaded="activeSession.uploaded"
              :total="activeSession.total"
              :errorMsg="storedRecorderError"
              :sessionId="activeSession.id"
              @pause="pauseRecording"
              @resume="resumeRecording"
              @stop="stopRecording"
              @dismiss="dismissState"
              @retry="startRecordingFromPopup"
              @export="exportSession"
            />
          </div>
        </div>

        <!-- Activity Feed / History (shown only on dashboard tab) -->
        <div class="border-t border-slate-200 dark:border-slate-900/60 pt-4 mt-auto">
          <ActivityFeed 
            :feed="activityFeed"
            @clear="clearActivityFeed"
          />
        </div>
      </div>

      <!-- 2. Library Tab View -->
      <div v-else-if="currentTab === 'library'" class="space-y-3 flex flex-col justify-start flex-grow">
        <div v-if="pastSessions.length === 0" class="flex-grow flex flex-col justify-center items-center text-center py-12 space-y-3">
          <div class="h-12 w-12 bg-slate-100 dark:bg-slate-900/60 rounded-xl flex items-center justify-center text-slate-400 dark:text-slate-500 ring-1 ring-slate-200 dark:ring-slate-800">
            <Library class="h-5 w-5" />
          </div>
          <div class="space-y-1">
            <p class="text-xs font-semibold text-slate-700 dark:text-slate-400">Library Empty</p>
            <p class="text-[10px] text-slate-550 dark:text-slate-500 max-w-[200px] leading-relaxed">No meeting recordings are stored locally in IndexedDB.</p>
          </div>
        </div>

        <div v-else class="space-y-3 max-h-[390px] overflow-y-auto pr-1">
          <div v-for="session in pastSessions" :key="session.sessionId" class="bg-white dark:bg-slate-900/40 rounded-xl p-3 border border-slate-200 dark:border-slate-800/80 space-y-2.5 hover:border-slate-300 dark:hover:border-slate-700/50 transition-all duration-200 shadow-sm dark:shadow-none">
            <div class="flex justify-between items-center">
              <div class="flex items-center gap-2">
                <span :class="['text-[9px] font-bold px-2 py-0.5 rounded border uppercase tracking-wider', session.platform === 'meet' ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/20' : 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-500/10 dark:text-blue-400 dark:border-blue-500/20']">
                  {{ session.platform === 'meet' ? 'Meet' : 'Teams' }}
                </span>
                <span :class="['text-[9px] font-bold px-1.5 py-0.2 rounded uppercase tracking-wide border', statusStyle(session.status)]">
                  {{ session.status }}
                </span>
              </div>
              <button 
                @click="deleteSession(session.sessionId)" 
                class="text-slate-400 hover:text-red-600 dark:text-slate-550 dark:hover:text-red-400 transition-colors p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
                title="Discard session"
              >
                <Trash2 class="h-3.5 w-3.5" />
              </button>
            </div>

            <!-- Meta details -->
            <div class="flex justify-between items-center text-[10px] text-slate-500 dark:text-slate-400 font-mono px-0.5">
              <span>{{ formatDate(session.startedAt) }}</span>
              <span class="text-slate-400 dark:text-slate-500">ID: ...{{ session.sessionId.slice(-8) }}</span>
            </div>

            <!-- Sync progress bar -->
            <div class="space-y-1 bg-slate-50 dark:bg-slate-950/60 p-2.5 rounded-lg border border-slate-150 dark:border-slate-900">
              <div class="flex justify-between text-[9px] font-semibold text-slate-655 dark:text-slate-400 font-mono">
                <span>Upload Progress:</span>
                <span class="text-slate-700 dark:text-slate-300 font-bold">{{ session.stats?.uploaded }}/{{ session.stats?.total }} chunks</span>
              </div>
              <div class="h-1.5 bg-slate-200 dark:bg-slate-900 rounded-full overflow-hidden">
                <div 
                  class="h-full bg-emerald-500 transition-all duration-300" 
                  :style="{ width: getPercent(session.stats) + '%' }"
                ></div>
              </div>
            </div>

            <!-- Action buttons -->
            <div class="flex items-center justify-end gap-2 text-[10px] pt-1">
              <button 
                v-if="session.stats?.uploaded < session.stats?.total"
                @click="resumeSync(session.sessionId)"
                class="px-3 py-1 bg-indigo-650 hover:bg-indigo-600 text-white font-semibold rounded-lg transition active:scale-[0.98] shadow-sm flex items-center gap-1"
              >
                <RefreshCw class="h-3 w-3" />
                Sync
              </button>
              <button 
                @click="exportSession(session.sessionId)"
                class="px-3 py-1 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-205 font-semibold rounded-lg border border-slate-200 dark:border-slate-700/50 transition active:scale-[0.98] flex items-center gap-1"
              >
                <Download class="h-3 w-3" />
                Export WebM
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- 3. Diagnostics Tab View -->
      <div v-else-if="currentTab === 'diagnostics'" class="space-y-3.5 flex flex-col justify-start flex-grow h-full">
        <!-- Actions & Info Header -->
        <div class="flex items-center justify-between flex-shrink-0">
          <span class="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Diagnostics Logs</span>
          <div class="flex gap-2">
            <button 
              @click="clearLogs"
              class="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-900 dark:hover:bg-slate-850 border border-slate-250 dark:border-slate-800 text-[10px] font-bold text-slate-550 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white transition active:scale-[0.98]"
            >
              Clear
            </button>
            <button 
              @click="scanActiveTab"
              :disabled="scanning"
              class="px-3 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-[10px] font-bold text-white transition disabled:opacity-50 flex items-center gap-1 shadow-sm active:scale-[0.98]"
            >
              <RefreshCw v-if="scanning" class="animate-spin h-3 w-3 text-white" />
              {{ scanning ? 'Scanning...' : 'Trigger Tab Scan' }}
            </button>
          </div>
        </div>

        <div v-if="scanResult" class="text-[9px] bg-indigo-50/50 border border-indigo-100 dark:bg-indigo-950/20 dark:border-indigo-500/20 p-2 rounded-lg font-mono text-indigo-700 dark:text-indigo-300 flex-shrink-0 leading-relaxed shadow-sm">
          <span class="text-indigo-805 dark:text-indigo-400 font-bold">Status:</span> {{ scanResult }}
        </div>

        <!-- Scrollable terminal logs -->
        <div class="flex-grow min-h-[160px] max-h-[200px] overflow-y-auto bg-slate-900 dark:bg-black/85 p-3 rounded-xl border border-slate-200 dark:border-slate-800/80 font-mono text-[9px] space-y-1.5 shadow-inner leading-normal">
          <div v-if="logs.length === 0" class="text-slate-500 text-center py-12">
            No pipeline events logged.
          </div>
          <div v-for="(log, idx) in logs" :key="idx" class="leading-relaxed border-b border-slate-800 dark:border-white/[0.02] pb-0.5 last:border-0 text-slate-300">
            <span class="text-slate-500">[{{ log.timestamp }}]</span>
            <span :class="[
              'ml-1.5 font-bold',
              log.level === 'error' ? 'text-red-400' :
              log.level === 'warn' ? 'text-amber-400' :
              log.level === 'scan' ? 'text-cyan-400' : 'text-emerald-400'
            ]">
              [{{ log.level.toUpperCase() }}]
            </span>
            <span class="ml-1.5">{{ log.message }}</span>
          </div>
        </div>
      </div>
    </div>
    
    <!-- Footer -->
    <div class="bg-slate-100 dark:bg-slate-900/50 border-t border-slate-200 dark:border-slate-900/80 px-4 py-2.5 flex items-center justify-between text-[9px] text-slate-450 dark:text-slate-500 flex-shrink-0 font-mono">
      <span>Pipeline v1.0.0</span>
      <span>Local IndexedDB buffer queue</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { clearDebugLogs, logActivity, RecorderStatus, type ActivityEvent } from '../../src/logger';
import { 
  LayoutDashboard, 
  Library, 
  Terminal, 
  Sun, 
  Moon, 
  RefreshCw, 
  Activity, 
  Trash2,
  Download
} from 'lucide-vue-next';

import StatusIndicator from '../../components/StatusIndicator.vue';
import EmptyState from '../../components/EmptyState.vue';
import MeetingStatusCard from '../../components/MeetingStatusCard.vue';
import RecordingStatusCard from '../../components/RecordingStatusCard.vue';
import PermissionStatusCard from '../../components/PermissionStatusCard.vue';
import ActivityFeed from '../../components/ActivityFeed.vue';

const DB_NAME = 'MeetingDataCollectorDB';

// Theme & Navigation State
const currentTab = ref<'dashboard' | 'library' | 'diagnostics'>('dashboard');
const isDark = ref(true);

// Health check state
const serverOnline = ref(false);

// Diagnostic logs & active meeting state
const logs = ref<any[]>([]);
const scanResult = ref('');
const scanning = ref(false);
const detectedMeeting = ref<{ platform: 'meet' | 'teams', title: string } | null>(null);

// Centralized storage status and activities
const storedRecorderStatus = ref<RecorderStatus>(RecorderStatus.IDLE);
const storedRecorderError = ref<string>('');
const activityFeed = ref<ActivityEvent[]>([]);

declare const chrome: any;

// Global Recorder State computed mapping
const recorderStatus = computed(() => {
  if (scanning.value) {
    return RecorderStatus.SCANNING;
  }
  
  if (storedRecorderStatus.value && storedRecorderStatus.value !== RecorderStatus.IDLE) {
    return storedRecorderStatus.value;
  }
  
  if (activeSession.value.status === 'recording') {
    return RecorderStatus.RECORDING;
  } else if (activeSession.value.status === 'paused') {
    return RecorderStatus.RECORDING;
  } else if (activeSession.value.status === 'completed') {
    return RecorderStatus.COMPLETED;
  } else if (activeSession.value.status === 'failed') {
    return RecorderStatus.FAILED;
  }
  
  if (detectedMeeting.value) {
    return RecorderStatus.MEETING_DETECTED;
  }
  
  return RecorderStatus.IDLE;
});

function toggleTheme() {
  isDark.value = !isDark.value;
  localStorage.setItem('theme', isDark.value ? 'dark' : 'light');
  if (isDark.value) {
    document.documentElement.classList.add('dark');
  } else {
    document.documentElement.classList.remove('dark');
  }
}

async function loadStoredState() {
  try {
    const data = await chrome.storage.local.get(['recorder_status', 'recorder_error', 'activity_feed']);
    storedRecorderStatus.value = data.recorder_status || RecorderStatus.IDLE;
    storedRecorderError.value = data.recorder_error || '';
    activityFeed.value = data.activity_feed || [];
  } catch (e) {}
}

async function clearActivityFeed() {
  try {
    await chrome.storage.local.set({ activity_feed: [] });
    activityFeed.value = [];
  } catch (e) {}
}

async function dismissState() {
  try {
    await chrome.storage.local.set({ 
      recorder_status: RecorderStatus.IDLE, 
      recorder_error: '' 
    });
    storedRecorderStatus.value = RecorderStatus.IDLE;
    storedRecorderError.value = '';
    queryRunningStatus();
    scanActiveTab();
  } catch (e) {}
}

// Auto scan the active tab
function scanActiveTab() {
  scanning.value = true;
  detectedMeeting.value = null;
  scanResult.value = 'Scanning active tab for meeting controls...';
  
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs: any) => {
    const activeTab = tabs[0];
    if (!activeTab || !activeTab.id || !activeTab.url) {
      scanning.value = false;
      scanResult.value = 'Scan skipped: No active tab found.';
      return;
    }

    const isMeet = activeTab.url.includes('meet.google.com');
    const isTeams = activeTab.url.includes('teams.microsoft.com') || activeTab.url.includes('teams.live.com');
    
    if (!isMeet && !isTeams) {
      scanning.value = false;
      scanResult.value = 'Scan complete: Not a meeting tab.';
      return;
    }

    chrome.tabs.sendMessage(activeTab.id, { type: 'CHECK_MEETING_ACTIVE' }, (response: any) => {
      scanning.value = false;
      if (chrome.runtime.lastError) {
        scanResult.value = 'Content script inactive. Please refresh meeting tab.';
        console.log('Content script not responding yet');
      } else if (response && response.active) {
        detectedMeeting.value = {
          platform: response.platform,
          title: activeTab.title || (response.platform === 'meet' ? 'Google Meet' : 'MS Teams')
        };
        scanResult.value = 'Active meeting detected! Ready to capture.';
        
        // Log to activity if not already recording
        if (activeSession.value.status === 'inactive' && storedRecorderStatus.value === RecorderStatus.IDLE) {
          logActivity(`Detected meeting: ${detectedMeeting.value.title}`);
        }
      } else {
        scanResult.value = 'Meeting page open, but active call not joined yet.';
      }
    });
  });
}

async function fetchLogs() {
  try {
    const data = await chrome.storage.local.get('debug_logs');
    logs.value = data.debug_logs || [];
  } catch (e) {}
}

function clearLogs() {
  clearDebugLogs().then(() => {
    logs.value = [];
  });
}

// Active Recording Session
const activeSession = ref<{
  status: string;
  id: string;
  duration: number;
  platform: 'meet' | 'teams';
  hasAudio: boolean;
  uploaded: number;
  total: number;
}>({
  status: 'inactive',
  id: '',
  duration: 0,
  platform: 'meet',
  hasAudio: true,
  uploaded: 0,
  total: 0
});

// Stored recording list
const pastSessions = ref<any[]>([]);

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 2);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onupgradeneeded = (event) => {
      const db = request.result;
      if (!db.objectStoreNames.contains('recordings')) {
        db.createObjectStore('recordings', { keyPath: 'sessionId' });
      }
      if (!db.objectStoreNames.contains('recording_chunks')) {
        db.createObjectStore('recording_chunks', { keyPath: 'chunkId' });
      }
    };
  });
}

// Fetch lists
async function loadRecordings() {
  try {
    const db = await openDB();
    const tx = db.transaction(['recordings', 'recording_chunks'], 'readonly');
    const recStore = tx.objectStore('recordings');
    const chunkStore = tx.objectStore('recording_chunks');

    const recRequest = recStore.getAll();
    recRequest.onsuccess = () => {
      const recs = recRequest.result;
      
      const chunkRequest = chunkStore.getAll();
      chunkRequest.onsuccess = () => {
        const chunks = chunkRequest.result;
        
        pastSessions.value = recs.map(rec => {
          const sChunks = chunks.filter((c: any) => c.sessionId === rec.sessionId);
          const uploaded = sChunks.filter((c: any) => c.uploadState === 'uploaded').length;
          return {
            ...rec,
            stats: {
              total: sChunks.length,
              uploaded
            }
          };
        }).reverse(); // Latest first
      };
    };
  } catch (err) {
    console.log('IndexedDB not initialized yet or empty:', err);
  }
}

function checkServerHealth() {
  fetch('http://localhost:3000/api/recordings/health')
    .then(res => {
      serverOnline.value = res.ok;
    })
    .catch(() => {
      serverOnline.value = false;
    });
}

function getPercent(stats: any) {
  if (!stats || stats.total === 0) return 0;
  return Math.round((stats.uploaded / stats.total) * 100);
}

// Helper to determine status style classes
function statusStyle(status: string) {
  if (status === 'recording') return 'bg-red-50 text-red-700 border-red-200 dark:bg-red-500/10 dark:text-red-400 dark:border-red-500/20';
  if (status === 'paused') return 'bg-yellow-50 text-yellow-755 border-yellow-200 dark:bg-yellow-500/10 dark:text-yellow-450 dark:border-yellow-500/20';
  if (status === 'completed') return 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-450 dark:border-emerald-500/20';
  return 'bg-slate-100 text-slate-500 border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700';
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString();
}

// Controls
function startRecordingFromPopup() {
  if (!detectedMeeting.value) return;
  const sessionId = 'session_' + crypto.randomUUID();
  
  chrome.runtime.sendMessage({
    type: 'START_RECORDING',
    sessionId,
    platform: detectedMeeting.value.platform
  }, (response: any) => {
    if (response && response.success) {
      storedRecorderStatus.value = RecorderStatus.REQUESTING_PERMISSION;
      queryRunningStatus();
    }
  });
}

function pauseRecording() {
  chrome.runtime.sendMessage({ type: 'PAUSE_RECORDING' });
}

function resumeRecording() {
  chrome.runtime.sendMessage({ type: 'RESUME_RECORDING' });
}

function stopRecording() {
  chrome.runtime.sendMessage({ type: 'STOP_RECORDING' });
}

// Local Sync Trigger
function resumeSync(sessionId: string) {
  chrome.runtime.sendMessage({ type: 'START_RECORDING', sessionId, platform: 'meet' });
}

async function exportSession(sessionId: string) {
  const db = await openDB();
  const tx = db.transaction('recording_chunks', 'readonly');
  const store = tx.objectStore('recording_chunks');
  const req = store.getAll();
  
  req.onsuccess = () => {
    const sessionChunks = req.result
      .filter((c: any) => c.sessionId === sessionId)
      .sort((a: any, b: any) => a.chunkIndex - b.chunkIndex);

    const blobs = sessionChunks.map((c: any) => c.blob).filter(Boolean);
    if (blobs.length === 0) {
      alert('No media chunks found locally in IndexedDB for this session. (Chunks are recycled after upload)');
      return;
    }

    const mergedBlob = new Blob(blobs, { type: 'video/webm' });
    const url = URL.createObjectURL(mergedBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `meeting_${sessionId}.webm`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };
}

async function deleteSession(sessionId: string) {
  if (!confirm('Are you sure you want to discard this recording session and all local cache chunks?')) return;
  
  const db = await openDB();
  
  const txRec = db.transaction('recordings', 'readwrite');
  txRec.objectStore('recordings').delete(sessionId);
  
  const txChunks = db.transaction('recording_chunks', 'readwrite');
  const storeChunks = txChunks.objectStore('recording_chunks');
  const req = storeChunks.getAll();
  req.onsuccess = () => {
    const chunkIds = req.result
      .filter((c: any) => c.sessionId === sessionId)
      .map((c: any) => c.chunkId);
    
    const txDelete = db.transaction('recording_chunks', 'readwrite');
    const storeDelete = txDelete.objectStore('recording_chunks');
    for (const cid of chunkIds) {
      storeDelete.delete(cid);
    }
    loadRecordings();
  };
}

// Query running status
function queryRunningStatus() {
  chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (response: any) => {
    if (response && response.recording !== 'inactive') {
      // Get chunk counts
      openDB().then(db => {
        const tx = db.transaction('recording_chunks', 'readonly');
        const req = tx.objectStore('recording_chunks').getAll();
        req.onsuccess = () => {
          const sChunks = req.result.filter((c: any) => c.sessionId === response.sessionId);
          const uploaded = sChunks.filter((c: any) => c.uploadState === 'uploaded').length;
          
          activeSession.value = {
            status: response.recording === 'recording' ? 'recording' : 'paused',
            id: response.sessionId || '',
            duration: response.duration || 0,
            platform: response.platform || 'meet',
            hasAudio: response.hasAudio,
            uploaded,
            total: sChunks.length
          };
        };
      }).catch(() => {
        activeSession.value = {
          status: response.recording === 'recording' ? 'recording' : 'paused',
          id: response.sessionId || '',
          duration: response.duration || 0,
          platform: response.platform || 'meet',
          hasAudio: response.hasAudio,
          uploaded: 0,
          total: 0
        };
      });
    } else {
      activeSession.value.status = 'inactive';
    }
  });
}

onMounted(() => {
  queryRunningStatus();
  loadRecordings();
  checkServerHealth();
  fetchLogs();
  loadStoredState();
  scanActiveTab();

  // Load saved theme
  const savedTheme = localStorage.getItem('theme');
  isDark.value = savedTheme !== 'light';
  if (isDark.value) {
    document.documentElement.classList.add('dark');
  } else {
    document.documentElement.classList.remove('dark');
  }

  // Listen for changes
  chrome.runtime.onMessage.addListener((message: any) => {
    if (message.type === 'RECORDING_STATE_CHANGED' || message.type === 'UPLOAD_PROGRESS_UPDATE') {
      queryRunningStatus();
      loadRecordings();
      loadStoredState();
    }
    if (message.type === 'DEBUG_LOGS_UPDATED') {
      fetchLogs();
    }
    if (message.type === 'ACTIVITY_FEED_UPDATED') {
      loadStoredState();
    }
  });

  // Periodically check server
  setInterval(checkServerHealth, 8000);
});
</script>
