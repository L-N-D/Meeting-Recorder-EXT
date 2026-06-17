/**
 * Utility to mix multiple audio streams (e.g., system audio and microphone audio)
 * into a single MediaStreamTrack using the Web Audio API.
 */

import type { AudioMixSettings } from './types';
import { DEFAULT_AUDIO_SETTINGS } from './types';

interface MixResult {
  mixedTrack: MediaStreamTrack;
  audioContext: AudioContext;
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

  const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
  const destination = audioContext.createMediaStreamDestination();

  if (systemAudioTrack) {
    const systemSourceStream = new MediaStream([systemAudioTrack]);
    const systemSourceNode = audioContext.createMediaStreamSource(systemSourceStream);
    const systemGain = audioContext.createGain();
    systemGain.gain.value = settings.systemGain;
    systemSourceNode.connect(systemGain);
    systemGain.connect(destination);

    if (settings.routeSystemToSpeakers) {
      const monitorGain = audioContext.createGain();
      monitorGain.gain.value = settings.systemGain;
      systemSourceNode.connect(monitorGain);
      monitorGain.connect(audioContext.destination);
    }
  }

  if (micAudioTrack) {
    const micSourceStream = new MediaStream([micAudioTrack]);
    const micSourceNode = audioContext.createMediaStreamSource(micSourceStream);
    const micGain = audioContext.createGain();
    micGain.gain.value = settings.micGain;
    micSourceNode.connect(micGain);
    micGain.connect(destination);
  }

  if (audioContext.state === 'suspended') {
    audioContext.resume().catch((err) => {
      console.error('Failed to resume AudioContext:', err);
    });
  }

  const mixedTrack = destination.stream.getAudioTracks()[0];

  return {
    mixedTrack,
    audioContext,
  };
}
