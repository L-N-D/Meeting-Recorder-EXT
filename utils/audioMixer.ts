/**
 * Utility to mix multiple audio streams (e.g., system audio and microphone audio)
 * into a single MediaStreamTrack using the Web Audio API.
 */

import type { AudioMixSettings } from './types';
import { DEFAULT_AUDIO_SETTINGS } from './types';

interface MixResult {
  mixedTrack: MediaStreamTrack;
  audioContext: AudioContext;
  micSourceNode?: MediaStreamAudioSourceNode;
  micGainNode?: GainNode;
  systemSourceNode?: MediaStreamAudioSourceNode;
  systemGainNode?: GainNode;
  compressorNode?: DynamicsCompressorNode;
  dummyOscillatorNode?: OscillatorNode;
  dummyGainNode?: GainNode;
}

/**
 * Mixes the audio tracks from a screen capture stream (system audio) and a microphone stream.
 */
export function mixAudioStreams(
  systemStream: MediaStream | null,
  micStream: MediaStream | null,
  settings: AudioMixSettings = DEFAULT_AUDIO_SETTINGS
): MixResult | null {
  const systemAudioTrack = systemStream?.getAudioTracks()[0];
  const micAudioTrack = micStream?.getAudioTracks()[0];

  if (!systemAudioTrack && !micAudioTrack) {
    return null;
  }

  // Khởi tạo AudioContext với sampleRate và latencyHint tối ưu cho việc ghi âm lâu dài
  const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({
    latencyHint: 'playback',
    sampleRate: 48000,
  });

  const destination = audioContext.createMediaStreamDestination();

  // Tạo DynamicsCompressorNode đóng vai trò limiter chống clipping vỡ âm
  const compressorNode = audioContext.createDynamicsCompressor();
  compressorNode.threshold.setValueAtTime(-24, audioContext.currentTime);
  compressorNode.knee.setValueAtTime(30, audioContext.currentTime);
  compressorNode.ratio.setValueAtTime(12, audioContext.currentTime);
  compressorNode.attack.setValueAtTime(0.003, audioContext.currentTime);
  compressorNode.release.setValueAtTime(0.25, audioContext.currentTime);

  compressorNode.connect(destination);

  let systemSourceNode: MediaStreamAudioSourceNode | undefined;
  let systemGainNode: GainNode | undefined;

  if (systemAudioTrack) {
    const systemSourceStream = new MediaStream([systemAudioTrack]);
    systemSourceNode = audioContext.createMediaStreamSource(systemSourceStream);
    systemGainNode = audioContext.createGain();
    systemGainNode.gain.value = settings.systemGain;
    systemSourceNode.connect(systemGainNode);
    systemGainNode.connect(compressorNode);

    if (settings.routeSystemToSpeakers) {
      const monitorGain = audioContext.createGain();
      monitorGain.gain.value = settings.systemGain;
      systemGainNode.connect(monitorGain);
      monitorGain.connect(audioContext.destination);
    }
  }

  let micSourceNode: MediaStreamAudioSourceNode | undefined;
  let micGainNode: GainNode | undefined;

  if (micAudioTrack) {
    const micSourceStream = new MediaStream([micAudioTrack]);
    micSourceNode = audioContext.createMediaStreamSource(micSourceStream);
    micGainNode = audioContext.createGain();
    micGainNode.gain.value = settings.micGain;
    micSourceNode.connect(micGainNode);
    micGainNode.connect(compressorNode);
  }

  // Dummy Oscillator để giữ thức AudioContext không bị suspend hoặc throttling khi chạy nền
  const dummyOscillatorNode = audioContext.createOscillator();
  const dummyGainNode = audioContext.createGain();
  dummyGainNode.gain.value = 0.00001; // Gần như câm hoàn toàn
  dummyOscillatorNode.frequency.value = 440;
  dummyOscillatorNode.connect(dummyGainNode);
  dummyGainNode.connect(audioContext.destination);
  dummyOscillatorNode.start();

  if (audioContext.state === 'suspended') {
    audioContext.resume().catch((err) => {
      console.error('Failed to resume AudioContext:', err);
    });
  }

  const mixedTrack = destination.stream.getAudioTracks()[0];

  return {
    mixedTrack,
    audioContext,
    micSourceNode,
    micGainNode,
    systemSourceNode,
    systemGainNode,
    compressorNode,
    dummyOscillatorNode,
    dummyGainNode,
  };
}
