// Offscreen Document Script
// Manages media capture, local storage (IndexedDB), integrity checks, and uploading
import { logDebug, logActivity, RecorderStatus } from './logger';

async function setRecorderStatus(status: RecorderStatus, error?: string) {
  try {
    await chrome.storage.local.set({ 
      recorder_status: status,
      recorder_error: error || null
    });
  } catch (e) {}
}

const BACKEND_URL = 'http://localhost:3000/api';

// --- IndexedDB Configuration ---
const DB_NAME = 'MeetingDataCollectorDB';
const DB_VERSION = 2;

interface Recording {
  sessionId: string;
  platform: 'meet' | 'teams';
  startedAt: string;
  endedAt?: string;
  status: 'recording' | 'paused' | 'completed' | 'failed';
}

interface RecordingChunk {
  chunkId: string; // `${sessionId}_${chunkIndex}`
  sessionId: string;
  chunkIndex: number;
  createdAt: string;
  blob: Blob | null; // Nullified after successful upload to conserve quota
  checksum: string;
  uploadState: 'pending' | 'uploading' | 'uploaded' | 'failed' | 'retrying';
  retryCount: number;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
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

// --- DB Helper Operations ---
async function saveRecording(recording: Recording) {
  const db = await openDB();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction('recordings', 'readwrite');
    const store = tx.objectStore('recordings');
    const req = store.put(recording);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function saveChunk(chunk: RecordingChunk) {
  const db = await openDB();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction('recording_chunks', 'readwrite');
    const store = tx.objectStore('recording_chunks');
    const req = store.put(chunk);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function getPendingChunks(): Promise<RecordingChunk[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('recording_chunks', 'readonly');
    const store = tx.objectStore('recording_chunks');
    const req = store.getAll();
    req.onsuccess = () => {
      const chunks = req.result as RecordingChunk[];
      resolve(chunks.filter(c => c.uploadState === 'pending' || c.uploadState === 'failed' || c.uploadState === 'retrying'));
    };
    req.onerror = () => reject(req.error);
  });
}

async function getActiveUploadsForSession(sessionId: string): Promise<RecordingChunk[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('recording_chunks', 'readonly');
    const store = tx.objectStore('recording_chunks');
    const req = store.getAll();
    req.onsuccess = () => {
      const chunks = req.result as RecordingChunk[];
      resolve(chunks.filter(c => c.sessionId === sessionId && ['pending', 'uploading', 'retrying'].includes(c.uploadState)));
    };
    req.onerror = () => reject(req.error);
  });
}

async function updateRecordingStatus(sessionId: string, status: 'recording' | 'paused' | 'completed' | 'failed') {
  const db = await openDB();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction('recordings', 'readwrite');
    const store = tx.objectStore('recordings');
    const req = store.get(sessionId);
    req.onsuccess = () => {
      const rec = req.result as Recording;
      if (rec) {
        rec.status = status;
        if (status === 'completed' || status === 'failed') {
          rec.endedAt = new Date().toISOString();
        }
        const putReq = store.put(rec);
        putReq.onsuccess = () => resolve();
        putReq.onerror = () => reject(putReq.error);
      } else {
        resolve();
      }
    };
    req.onerror = () => reject(req.error);
  });
}

// --- Cryptographic Hash Helpers ---
async function calculateSHA256(blob: Blob): Promise<string> {
  const arrayBuffer = await blob.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest('SHA-2-256' in crypto ? 'SHA-256' : 'SHA-256', arrayBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// --- Recorder State ---
let mediaRecorder: MediaRecorder | null = null;
let activeStream: MediaStream | null = null;
let currentSessionId: string | null = null;
let currentChunkIndex = 0;
let durationInterval: any = null;
let durationSeconds = 0;
let isAudioActive = false;
let activeDbWrites = 0;

// --- Upload Loop Management ---
let isUploading = false;

async function startUploadWorker() {
  if (isUploading) return;
  isUploading = true;
  console.log('Upload worker started.');

  try {
    while (true) {
      const pending = await getPendingChunks();
      if (pending.length === 0) {
        break; // No more chunks to upload
      }

      // Sort by index to upload sequentially
      pending.sort((a, b) => a.chunkIndex - b.chunkIndex);
      logDebug(`Upload worker processing ${pending.length} pending chunks sequentially...`, 'info');

      for (const chunk of pending) {
        if (!chunk.blob) {
          // If blob was somehow cleared but not uploaded, mark failed
          chunk.uploadState = 'failed';
          await saveChunk(chunk);
          continue;
        }

        console.log(`Uploading chunk ${chunk.chunkIndex} for session ${chunk.sessionId}...`);
        chunk.uploadState = 'uploading';
        await saveChunk(chunk);

        // Update progress
        chrome.runtime.sendMessage({
          type: 'UPLOAD_PROGRESS_UPDATE',
          sessionId: chunk.sessionId,
          chunkIndex: chunk.chunkIndex,
          status: 'uploading'
        });

        const success = await uploadChunkWithRetry(chunk);
        if (success) {
          chunk.uploadState = 'uploaded';
          chunk.blob = null; // Release memory references immediately!
          await saveChunk(chunk);
          logDebug(`Chunk index ${chunk.chunkIndex} for session ${chunk.sessionId} uploaded and cleared from IndexedDB.`, 'info');

          chrome.runtime.sendMessage({
            type: 'UPLOAD_PROGRESS_UPDATE',
            sessionId: chunk.sessionId,
            chunkIndex: chunk.chunkIndex,
            status: 'uploaded'
          });
        } else {
          chunk.retryCount++;
          if (chunk.retryCount >= 5) {
            chunk.uploadState = 'failed';
            logDebug(`Chunk index ${chunk.chunkIndex} reached max retry limit (5). Upload marked failed.`, 'error');
          } else {
            chunk.uploadState = 'retrying';
            logDebug(`Chunk index ${chunk.chunkIndex} upload failed. Scheduled for retry (attempt ${chunk.retryCount}).`, 'warn');
          }
          await saveChunk(chunk);

          chrome.runtime.sendMessage({
            type: 'UPLOAD_PROGRESS_UPDATE',
            sessionId: chunk.sessionId,
            chunkIndex: chunk.chunkIndex,
            status: chunk.uploadState
          });
        }
      }

      // Wait a moment before checking for new chunks
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  } catch (err) {
    console.error('Error in upload worker:', err);
  } finally {
    isUploading = false;
    console.log('Upload worker sleeping.');
  }
}

async function uploadChunkWithRetry(chunk: RecordingChunk): Promise<boolean> {
  const maxRetries = 5;
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      // Setup payload
      const formData = new FormData();
      formData.append('chunkIndex', chunk.chunkIndex.toString());
      formData.append('checksum', chunk.checksum);
      formData.append('file', chunk.blob!);

      // Exponential backoff wait
      if (attempt > 0) {
        const backoffTime = Math.pow(2, attempt) * 1000;
        console.log(`Retrying upload in ${backoffTime}ms...`);
        await new Promise(resolve => setTimeout(resolve, backoffTime));
      }

      const response = await fetch(`${BACKEND_URL}/recordings/${chunk.sessionId}/chunks`, {
        method: 'POST',
        headers: {
          'Idempotency-Key': chunk.chunkId
        },
        body: formData
      });

      if (response.ok) {
        console.log(`Chunk ${chunk.chunkIndex} uploaded successfully.`);
        return true;
      } else {
        console.warn(`Chunk upload failed with status ${response.status}: ${await response.text()}`);
      }
    } catch (err) {
      console.warn(`Upload attempt ${attempt + 1} failed due to network error:`, err);
    }
  }
  return false;
}

// --- Recorder Methods ---
async function startRecording(sessionId: string, platform: 'meet' | 'teams') {
  try {
    currentSessionId = sessionId;
    currentChunkIndex = 0;
    durationSeconds = 0;

    logDebug(`Display Media capture requested for session ${sessionId}...`, 'info');
    
    // Request display media
    await setRecorderStatus(RecorderStatus.REQUESTING_PERMISSION);
    await logActivity('Requesting screen and microphone permissions...');

    activeStream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        frameRate: 15
      },
      audio: true
    });

    await setRecorderStatus(RecorderStatus.PREPARING);
    await logActivity('Permissions granted. Preparing recording...');

    // Audio validation
    const audioTracks = activeStream.getAudioTracks();
    isAudioActive = audioTracks.length > 0 && audioTracks[0].enabled && audioTracks[0].readyState === 'live';
    logDebug(`Media stream acquired. Audio tracks found: ${audioTracks.length} (Active: ${isAudioActive})`, 'info');
    
    chrome.runtime.sendMessage({
      type: 'AUDIO_STATUS_CHANGED',
      hasAudio: isAudioActive
    });

    // Setup track end listener (user stops sharing via native bar)
    const videoTrack = activeStream.getVideoTracks()[0];
    videoTrack.onended = () => {
      logDebug('User clicked browser native Stop Sharing bar.', 'info');
      stopRecording();
    };

    // Codec support validation
    let selectedCodec = 'video/webm;codecs=vp9,opus';
    if (!MediaRecorder.isTypeSupported(selectedCodec)) {
      logDebug('vp9,opus codec not supported, falling back to vp8,opus', 'warn');
      selectedCodec = 'video/webm;codecs=vp8,opus';
    }

    mediaRecorder = new MediaRecorder(activeStream, {
      mimeType: selectedCodec
    });
    logDebug(`MediaRecorder configured with codec: ${selectedCodec}`, 'info');

    // Store session meta
    await saveRecording({
      sessionId,
      platform,
      startedAt: new Date().toISOString(),
      status: 'recording'
    });

    mediaRecorder.ondataavailable = async (event) => {
      if (event.data && event.data.size > 0) {
        activeDbWrites++;
        const chunkIndex = currentChunkIndex++;
        const blob = event.data;
        const checksum = await calculateSHA256(blob);
        const chunkId = `${sessionId}_${chunkIndex}`;

        const chunkObj: RecordingChunk = {
          chunkId,
          sessionId,
          chunkIndex,
          createdAt: new Date().toISOString(),
          blob,
          checksum,
          uploadState: 'pending',
          retryCount: 0
        };

        try {
          await saveChunk(chunkObj);
          logDebug(`Chunk index ${chunkIndex} (size: ${Math.round(blob.size / 1024)} KB) successfully buffered in IndexedDB. Checksum: ${checksum.slice(0, 16)}...`, 'info');
          // Trigger queue
          startUploadWorker();
        } catch (quotaError) {
          logDebug(`IndexedDB write failed (likely quota exceeded): ${quotaError}`, 'error');
          chrome.runtime.sendMessage({
            type: 'RECORDING_STATE_CHANGED',
            status: 'failed',
            error: 'Local storage quota exceeded. Recording paused.'
          });
          pauseRecording();
        } finally {
          activeDbWrites--;
        }
      }
    };

    // Collect 5-second slices
    mediaRecorder.start(5000);
    console.log('MediaRecorder started with 5s time slice.');
    await setRecorderStatus(RecorderStatus.RECORDING);
    await logActivity('Recording active.');

    // Start UI duration counter
    durationInterval = setInterval(() => {
      durationSeconds++;
      chrome.runtime.sendMessage({
        type: 'RECORDING_STATE_CHANGED',
        status: 'recording',
        duration: durationSeconds,
        sessionId
      });
    }, 1000);

    // Initial server setup
    await fetch(`${BACKEND_URL}/recordings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        sessionId,
        platform,
        startedAt: new Date().toISOString()
      })
    }).catch(err => {
      console.warn('Ingest server offline, local queue will buffer uploads:', err);
    });

  } catch (err: any) {
    console.error('Failed to start recording:', err);
    let state = RecorderStatus.FAILED;
    let errMsg = err.message || 'Stream capture permission denied.';
    if (err.name === 'NotAllowedError') {
      state = RecorderStatus.PERMISSION_DENIED;
      errMsg = 'Microphone or screen capture permission was denied.';
      await logActivity('Permissions denied by user.');
    } else {
      await logActivity(`Recording startup failed: ${errMsg}`);
    }
    await setRecorderStatus(state, errMsg);

    chrome.runtime.sendMessage({
      type: 'RECORDING_STATE_CHANGED',
      status: state === RecorderStatus.PERMISSION_DENIED ? 'permission_denied' : 'failed',
      error: errMsg
    });
    cleanup();
  }
}

async function pauseRecording() {
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    logDebug('INFO', 'Pausing recording feed...');
    mediaRecorder.pause();
    await logActivity('Recording paused.');
    await setRecorderStatus(RecorderStatus.PAUSED);
    if (durationInterval) {
      clearInterval(durationInterval);
      durationInterval = null;
    }
    
    if (currentSessionId) {
      openDB().then(db => {
        const tx = db.transaction('recordings', 'readwrite');
        tx.objectStore('recordings').get(currentSessionId!).onsuccess = (e: any) => {
          const rec = e.target.result;
          if (rec) {
            rec.status = 'paused';
            tx.objectStore('recordings').put(rec);
          }
        };
      });
    }

    logDebug('INFO', 'Recording session state set to PAUSED.');
    chrome.runtime.sendMessage({
      type: 'RECORDING_STATE_CHANGED',
      status: 'paused',
      duration: durationSeconds
    });
  }
}

async function resumeRecording() {
  if (mediaRecorder && mediaRecorder.state === 'paused') {
    logDebug('INFO', 'Resuming recording feed...');
    mediaRecorder.resume();
    await logActivity('Recording resumed.');
    await setRecorderStatus(RecorderStatus.RECORDING);
    durationInterval = setInterval(() => {
      durationSeconds++;
      chrome.runtime.sendMessage({
        type: 'RECORDING_STATE_CHANGED',
        status: 'recording',
        duration: durationSeconds,
        sessionId: currentSessionId
      });
    }, 1000);

    if (currentSessionId) {
      openDB().then(db => {
        const tx = db.transaction('recordings', 'readwrite');
        tx.objectStore('recordings').get(currentSessionId!).onsuccess = (e: any) => {
          const rec = e.target.result;
          if (rec) {
            rec.status = 'recording';
            tx.objectStore('recordings').put(rec);
          }
        };
      });
    }

    logDebug('INFO', 'Recording session state set to ACTIVE.');
    chrome.runtime.sendMessage({
      type: 'RECORDING_STATE_CHANGED',
      status: 'recording',
      duration: durationSeconds
    });
  }
}

async function stopRecording() {
  logDebug('INFO', 'Stopping recording stream, flushing buffers...');
  await setRecorderStatus(RecorderStatus.SAVING);
  await logActivity('Recording stopped. Uploading buffers...');

  if (durationInterval) {
    clearInterval(durationInterval);
    durationInterval = null;
  }

  const sessionId = currentSessionId;

  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    const stopPromise = new Promise<void>((resolve) => {
      mediaRecorder!.onstop = () => {
        resolve();
      };
    });
    mediaRecorder.stop();
    await stopPromise;
    logDebug('INFO', 'MediaRecorder stopped and onstop event fired.');
  }

  if (activeStream) {
    activeStream.getTracks().forEach(track => track.stop());
    activeStream = null;
  }

  // Wait for any pending DB writes from ondataavailable to complete
  while (activeDbWrites > 0) {
    logDebug('INFO', `Waiting for ${activeDbWrites} database writes to finish...`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  if (sessionId) {
    await updateRecordingStatus(sessionId, 'completed');

    chrome.runtime.sendMessage({
      type: 'RECORDING_STATE_CHANGED',
      status: 'completed',
      duration: durationSeconds
    });

    // Ensure upload worker is running to process final chunks
    startUploadWorker();

    // Wait for all chunks of this session to finish uploading (status uploaded or failed)
    let pendingChunks = await getActiveUploadsForSession(sessionId);
    while (pendingChunks.length > 0) {
      logDebug('INFO', `Waiting for ${pendingChunks.length} chunks to upload for session ${sessionId}...`);
      await new Promise((resolve) => setTimeout(resolve, 500));
      pendingChunks = await getActiveUploadsForSession(sessionId);
    }
    logDebug('INFO', `All chunks for session ${sessionId} have been processed (uploaded or failed).`);

    logDebug('INFO', 'Session capture finalized. Notifying ingestion server for assembly...');

    // Notify backend complete
    try {
      const res = await fetch(`${BACKEND_URL}/recordings/${sessionId}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      if (res.ok) {
        logDebug('INFO', `Server assembly completed successfully for session: ${sessionId}`);
        await logActivity('Recording saved and uploaded successfully.');
        await setRecorderStatus(RecorderStatus.COMPLETED);
      } else {
        const errorText = await res.text();
        logDebug('ERROR', `Server assembly failed with status ${res.status}: ${errorText}`);
        await logActivity(`Recording saved but assembly failed: ${errorText}`);
        await setRecorderStatus(RecorderStatus.FAILED, `Assembly failed: ${errorText}`);
      }
    } catch (err: any) {
      logDebug('WARN', `Could not trigger server assembly: ${err.message}`);
      await logActivity(`Server connection lost. Recording buffered locally.`);
      await setRecorderStatus(RecorderStatus.COMPLETED); // Still completed locally
    }
  }

  cleanup();
}

function cleanup() {
  mediaRecorder = null;
  activeStream = null;
  currentSessionId = null;
  if (durationInterval) {
    clearInterval(durationInterval);
    durationInterval = null;
  }
}

// --- Message Listener for Recording Commands ---
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'START_RECORDING') {
    startRecording(message.sessionId, message.platform);
    sendResponse({ success: true });
    return false;
  }
  if (message.type === 'STOP_RECORDING') {
    stopRecording().then(() => sendResponse({ success: true }));
    return true;
  }
  if (message.type === 'PAUSE_RECORDING') {
    pauseRecording();
    sendResponse({ success: true });
    return false;
  }
  if (message.type === 'RESUME_RECORDING') {
    resumeRecording();
    sendResponse({ success: true });
    return false;
  }
  if (message.type === 'GET_STATUS') {
    sendResponse({
      recording: mediaRecorder ? mediaRecorder.state : 'inactive',
      duration: durationSeconds,
      sessionId: currentSessionId,
      hasAudio: isAudioActive
    });
    return false;
  }
});

// Resume uploading pending items upon startup
openDB().then(() => {
  console.log('IndexedDB initialized, launching upload queue recovery...');
  startUploadWorker();
});
