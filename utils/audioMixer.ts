/**
 * Utility to mix multiple audio streams (e.g., system audio and microphone audio)
 * into a single MediaStreamTrack using the Web Audio API.
 */

interface MixResult {
  mixedTrack: MediaStreamTrack;
  audioContext: AudioContext;
}

/**
 * Mixes the audio tracks from a screen capture stream (system audio) and a microphone stream.
 * 
 * @param systemStream The MediaStream obtained from screen sharing (may contain system audio).
 * @param micStream The MediaStream obtained from the microphone (getUserMedia).
 * @returns An object containing the mixed MediaStreamTrack and the AudioContext (to close it later), or null if no audio is present.
 */
export function mixAudioStreams(
  systemStream: MediaStream | null,
  micStream: MediaStream | null
): MixResult | null {
  const systemAudioTrack = systemStream?.getAudioTracks()[0];
  const micAudioTrack = micStream?.getAudioTracks()[0];

  // If there is no audio to mix, return null
  if (!systemAudioTrack && !micAudioTrack) {
    return null;
  }

  // Create standard AudioContext
  const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
  const destination = audioContext.createMediaStreamDestination();

  // Route system audio if available
  if (systemAudioTrack) {
    const systemSourceStream = new MediaStream([systemAudioTrack]);
    const systemSourceNode = audioContext.createMediaStreamSource(systemSourceStream);
    systemSourceNode.connect(destination);
    
    // CRITICAL: Route the captured audio back to the local output speakers
    // so the user can hear the meeting/tab sounds while they are recording it!
    systemSourceNode.connect(audioContext.destination);
  }

  // Route microphone audio if available (DO NOT route to speakers to avoid feedback loop)
  if (micAudioTrack) {
    const micSourceStream = new MediaStream([micAudioTrack]);
    const micSourceNode = audioContext.createMediaStreamSource(micSourceStream);
    micSourceNode.connect(destination);
  }

  // Ensure AudioContext is active and running
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
