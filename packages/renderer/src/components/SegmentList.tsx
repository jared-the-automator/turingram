import React from 'react';
import type { TranscriptSegment } from '@turingyde/transcript-core';

function formatTime(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export default function SegmentList({ segments }: { segments: TranscriptSegment[] }) {
  return (
    <div className="space-y-6">
      {segments.map(seg => (
        <div key={seg.id} className="group">
          <div className="flex items-baseline gap-2.5 mb-1.5">
            <span className="font-mono tabular text-[10px] text-sub tracking-wide">
              {formatTime(seg.startTime)}
            </span>
            <span className="text-[11px] font-semibold text-celeste tracking-wide uppercase">
              {seg.speakerLabel}
            </span>
          </div>
          <p className="text-[13.5px] text-hi leading-relaxed pl-0 max-w-[65ch]">
            {seg.text}
          </p>
        </div>
      ))}
    </div>
  );
}
