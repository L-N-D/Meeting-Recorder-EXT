import React, { useEffect, useRef } from 'react';
import { Mic } from 'lucide-react';
import { Icon } from './Icon';

interface MicLevelMeterProps {
  enabled: boolean;
}

export const MicLevelMeter: React.FC<MicLevelMeterProps> = ({ enabled }) => {
  const barRef = useRef<HTMLDivElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled) {
      return undefined;
    }

    let audioContext: AudioContext | null = null;
    let analyser: AnalyserNode | null = null;
    let cancelled = false;

    const startMeter = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        streamRef.current = stream;
        audioContext = new AudioContext();
        analyser = audioContext.createAnalyser();
        analyser.fftSize = 256;
        const source = audioContext.createMediaStreamSource(stream);
        source.connect(analyser);

        const data = new Uint8Array(analyser.frequencyBinCount);
        const tick = () => {
          if (!analyser || !barRef.current) {
            return;
          }
          analyser.getByteFrequencyData(data);
          const average = data.reduce((sum, value) => sum + value, 0) / data.length;
          const level = Math.min(100, Math.round((average / 128) * 100));
          barRef.current.style.width = `${Math.max(4, level)}%`;
          rafRef.current = requestAnimationFrame(tick);
        };
        tick();
      } catch {
        if (barRef.current) {
          barRef.current.style.width = '0%';
        }
      }
    };

    void startMeter();

    return () => {
      cancelled = true;
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      audioContext?.close().catch(() => undefined);
    };
  }, [enabled]);

  if (!enabled) {
    return null;
  }

  return (
    <div className="mic-meter">
      <span className="mic-meter-label">
        <Icon icon={Mic} size={14} className="mic-meter-icon" />
        Mic level
      </span>
      <div className="mic-meter-track">
        <div ref={barRef} className="mic-meter-bar" />
      </div>
    </div>
  );
};
