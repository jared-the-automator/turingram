import fs from 'fs';
import path from 'path';
import type { Meeting, TranscriptSegment } from '@turingyde/transcript-core';
import { buildAgentHook } from './agentHook';
import { meetingBaseName } from './naming';

export const ALLOWED_FORMATS = ['md', 'txt', 'json', 'srt'] as const;
export type ExportFormat = typeof ALLOWED_FORMATS[number];

export function exportMeeting(
  outDir: string,
  meeting: Meeting,
  segments: TranscriptSegment[],
  format: ExportFormat = 'md',
): string {
  const dir = path.resolve(outDir);
  fs.mkdirSync(dir, { recursive: true });

  // Shared with the agent-hook JSON — see naming.ts for the shape and why.
  const filePath = path.join(dir, `${meetingBaseName(meeting)}.${format}`);

  // Prevent path traversal — the slug comes from a user-set title, so the
  // resolved path must stay inside the destination directory.
  if (!path.resolve(filePath).startsWith(dir + path.sep)) {
    throw new Error('Export path traversal detected');
  }

  let content: string;
  switch (format) {
    case 'txt':  content = buildPlainText(meeting, segments); break;
    case 'json': content = buildJson(meeting, segments); break;
    case 'srt':  content = buildSrt(segments); break;
    default:     content = buildMarkdown(meeting, segments);
  }

  fs.writeFileSync(filePath, content);
  return filePath;
}

function buildMarkdown(meeting: Meeting, segments: TranscriptSegment[]): string {
  const lines: string[] = [
    `# ${meeting.title}`,
    `**Date:** ${new Date(meeting.startedAt).toLocaleString()}  `,
    `**Duration:** ${formatDuration(meeting.durationSec)}`,
    '',
  ];
  if (meeting.notes) lines.push('## Notes', '', meeting.notes, '');
  lines.push('## Transcript', '');
  for (const seg of segments) {
    lines.push(`**${formatTimestamp(seg.startTime)} ${seg.speakerLabel}:** ${seg.text}`, '');
  }
  return lines.join('\n');
}

function buildPlainText(meeting: Meeting, segments: TranscriptSegment[]): string {
  const lines: string[] = [
    meeting.title,
    `${new Date(meeting.startedAt).toLocaleString()} · ${formatDuration(meeting.durationSec)}`,
    '',
  ];
  if (meeting.notes) lines.push('Notes', '-----', meeting.notes, '');
  for (const seg of segments) {
    lines.push(`[${formatTimestamp(seg.startTime)}] ${seg.speakerLabel.toUpperCase()}: ${seg.text}`, '');
  }
  return lines.join('\n');
}

// Exporting JSON hands out the same object an agent reads from
// transcripts/<id>.json, rather than a second, weaker shape. The old one
// formatted every time as a clock string and dropped the summary and action
// items — the two things a consumer most wants and would otherwise have to
// re-derive from the full transcript.
function buildJson(meeting: Meeting, segments: TranscriptSegment[]): string {
  return JSON.stringify(buildAgentHook(meeting, segments), null, 2);
}

function buildSrt(segments: TranscriptSegment[]): string {
  return segments.map((seg, i) => [
    String(i + 1),
    `${formatSrtTime(seg.startTime)} --> ${formatSrtTime(seg.endTime)}`,
    `${seg.speakerLabel.toUpperCase()}: ${seg.text}`,
    '',
  ].join('\n')).join('\n');
}

function formatSrtTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.round((seconds % 1) * 1000);
  return `${pad(h, 2)}:${pad(m, 2)}:${pad(s, 2)},${pad(ms, 3)}`;
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

// Rolls over to H:MM:SS past the hour — "60:02" is not a time.
function formatTimestamp(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return h > 0 ? `${h}:${pad(m, 2)}:${pad(s, 2)}` : `${pad(m, 2)}:${pad(s, 2)}`;
}

function pad(n: number, width: number): string {
  return String(n).padStart(width, '0');
}
