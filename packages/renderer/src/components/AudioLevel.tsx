import React, { useEffect, useRef, useState } from 'react';

const MULTIPLIERS = [1, 2, 3, 4, 5, 2, 4, 1];

export default function AudioLevel() {
  const [volume, setVolume] = useState(0);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const activeRef = useRef(true);

  useEffect(() => {
    activeRef.current = true;
    let stream: MediaStream | null = null;

    navigator.mediaDevices.getUserMedia({ audio: true, video: false })
      .then(s => {
        if (!activeRef.current) { s.getTracks().forEach(t => t.stop()); return; }
        stream = s;
        const ctx = new AudioContext();
        const source = ctx.createMediaStreamSource(s);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        // Keep browser default smoothingTimeConstant (0.8) — same as Turingyde
        source.connect(analyser);
        analyserRef.current = analyser;

        const dataArray = new Uint8Array(analyser.frequencyBinCount);
        intervalRef.current = setInterval(() => {
          if (!analyserRef.current) return;
          analyserRef.current.getByteFrequencyData(dataArray);
          let sum = 0;
          for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
          const vol = Math.min(100, (sum / dataArray.length / 220) * 100);
          setVolume(vol);
        }, 60);
      })
      .catch(() => {
        // No mic access — idle at minimum height
        setVolume(0);
      });

    return () => {
      activeRef.current = false;
      if (intervalRef.current) clearInterval(intervalRef.current);
      analyserRef.current = null;
      stream?.getTracks().forEach(t => t.stop());
    };
  }, []);

  return (
    <div className="flex items-end gap-0.5 px-1 h-8">
      {MULTIPLIERS.map((multiplier, i) => (
        <div
          key={i}
          className="w-1 rounded-full transition-all duration-75"
          style={{
            height: `${Math.min(32, Math.max(4, volume * (multiplier / 5)))}px`,
            backgroundColor: `oklch(0.85 0.17 162)`,
            opacity: 0.4 + (volume / 200),
          }}
        />
      ))}
    </div>
  );
}
