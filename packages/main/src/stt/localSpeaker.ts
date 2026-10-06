import { spawn } from 'child_process'
import type { TranscriptSegment } from '@turingyde/transcript-core'
import { ffmpegPath } from '../ffmpegPath';

// Identifies which diarized speaker is the person at this machine, and relabels
// them "You".
//
// This is the one attribution fact we get for free and a competitor cannot infer:
// a stereo capture's LEFT channel is the microphone, so anything loud there is,
// by construction, the local speaker. Diarization on the folded mono mix has no
// idea which cluster that is. We recover it by asking when the mic channel was
// active and seeing whose speech lines up.
//
// Requires preprocess.ts to leave the duration untouched — segment timestamps and
// these ranges must share one clock.

export type Range = [start: number, end: number]

// Local speech has to clear this to count as activity. Measured on real hardware,
// post-AEC speaker bleed sits around -69 dBFS, far under this, so the remote party
// leaking into the mic does not register as the local person talking.
const NOISE_FLOOR_DB = -35
const MIN_SILENCE_SEC = 0.5

// A speaker must overlap mic activity this much of their speaking time...
const MIN_OVERLAP_RATIO = 0.5
// ...and beat the runner-up by this factor. Without the margin, two people on a
// bleedy recording both look local. Mislabelling someone else "You" is worse than
// leaving "Speaker 2", so an ambiguous result pins nothing.
const MIN_MARGIN = 1.5

// Converts silencedetect's silent spans into the active spans between them.
// Exported because this inversion is where off-by-one errors live.
export function activeRangesFromSilence(silences: Range[], duration: number): Range[] {
  if (duration <= 0) return []
  const sorted = [...silences]
    .map(([s, e]) => [Math.max(0, s), Math.min(duration, e)] as Range)
    .filter(([s, e]) => e > s)
    .sort((a, b) => a[0] - b[0])

  const active: Range[] = []
  let cursor = 0
  for (const [s, e] of sorted) {
    if (s > cursor) active.push([cursor, s])
    cursor = Math.max(cursor, e)
  }
  if (cursor < duration) active.push([cursor, duration])
  return active.filter(([s, e]) => e - s > 0.01)
}

function overlap(a: Range, b: Range): number {
  return Math.max(0, Math.min(a[1], b[1]) - Math.max(a[0], b[0]))
}

// Runs silencedetect over the mic channel only. Returns the spans where the local
// person was audibly speaking.
export function detectMicActivity(audioPath: string, signal?: AbortSignal): Promise<Range[]> {
  return detectChannelActivity(audioPath, 0, signal)
}

// Same, for the RIGHT channel — the system monitor, i.e. the far end of the call.
// Its silence is the strongest fact the recording carries: no remote audio means
// nobody on the call was talking, whatever the diarizer thinks.
export function detectRemoteActivity(audioPath: string, signal?: AbortSignal): Promise<Range[]> {
  return detectChannelActivity(audioPath, 1, signal)
}

// channel 0 = mic (left), 1 = system monitor (right). On a mono capture there is
// no channel to separate, so callers must not use this.
export function detectChannelActivity(
  audioPath: string,
  channel: 0 | 1,
  signal?: AbortSignal,
): Promise<Range[]> {
  return new Promise(resolve => {
    const proc = spawn(ffmpegPath(), [
      '-i', audioPath,
      '-af', `pan=mono|c0=c${channel},silencedetect=noise=${NOISE_FLOOR_DB}dB:d=${MIN_SILENCE_SEC}`,
      '-f', 'null', '-',
    ], { signal })

    let err = ''
    proc.stderr.on('data', (d: Buffer) => { err += d.toString() })
    // Best-effort: a detection failure must never lose a transcript, so every
    // failure path yields "no activity" and the caller simply skips pinning.
    proc.on('error', () => resolve([]))
    proc.on('close', () => {
      const duration = (() => {
        // "Duration: 00:01:00.53" — silencedetect reports no total on its own.
        const m = err.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/)
        if (!m) return 0
        return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])
      })()
      if (duration <= 0) { resolve([]); return }

      const silences: Range[] = []
      let open: number | null = null
      for (const line of err.split('\n')) {
        const start = line.match(/silence_start:\s*(-?[\d.]+)/)
        if (start) { open = Number(start[1]); continue }
        const end = line.match(/silence_end:\s*(-?[\d.]+)/)
        if (end && open !== null) { silences.push([open, Number(end[1])]); open = null }
      }
      // A file ending in silence opens a span that never closes.
      if (open !== null) silences.push([open, duration])

      resolve(activeRangesFromSilence(silences, duration))
    })
  })
}

// Relabels whichever speaker best matches mic activity as "You". Returns the
// segments unchanged when the answer is not clear enough to be worth asserting.
export function pinLocalSpeaker(
  segments: TranscriptSegment[],
  micRanges: Range[],
  label = 'You',
): TranscriptSegment[] {
  if (segments.length === 0 || micRanges.length === 0) return segments

  const bySpeaker = new Map<string, { spoken: number; matched: number }>()
  for (const seg of segments) {
    const dur = Math.max(0, seg.endTime - seg.startTime)
    if (dur <= 0) continue
    const stat = bySpeaker.get(seg.speakerLabel) ?? { spoken: 0, matched: 0 }
    stat.spoken += dur
    for (const r of micRanges) stat.matched += overlap([seg.startTime, seg.endTime], r)
    bySpeaker.set(seg.speakerLabel, stat)
  }

  const ranked = [...bySpeaker.entries()]
    .map(([speaker, { spoken, matched }]) => ({ speaker, ratio: spoken > 0 ? matched / spoken : 0 }))
    .sort((a, b) => b.ratio - a.ratio)

  const [best, next] = ranked
  if (!best || best.ratio < MIN_OVERLAP_RATIO) return segments
  if (next && next.ratio > 0 && best.ratio < next.ratio * MIN_MARGIN) return segments

  return segments.map(seg =>
    seg.speakerLabel === best.speaker ? { ...seg, speakerLabel: label } : seg,
  )
}

// A segment may carry no remote audio at all and still be attributed to a remote
// participant. That happens after the call ends: the recording runs on, something
// in the room makes noise, and the diarizer — which sees only the folded mono mix
// and has no idea the call is over — hands it to whoever it sounds most like.
//
// Observed 2026-07-31 on a real client call. Everyone said goodbye at 25:52; the
// system channel went silent there and stayed silent. At 28:57 and 29:01 an
// Instagram reel playing in the user's room was transcribed and attributed to two
// named clients who had already hung up — 27 words they never said, in a file
// that goes in their folder.
//
// The test is not a heuristic. If no remote audio arrived, nobody remote was
// talking; if the mic was live at the same moment, the sound came from THIS room.
// Post-AEC speaker bleed sits near -69 dBFS, far under the -35 dB floor, so a
// remote voice cannot register as mic activity and be mistaken for local noise.
// Both conditions must hold, and either channel failing detection disables the
// rule entirely rather than guessing.

// Remote overlap at or under this share of the segment counts as "no remote
// audio". Not exactly zero: a segment boundary can clip a few samples of the
// neighbouring turn.
const PHANTOM_REMOTE_RATIO = 0.02
// ...and the mic must have been carrying this much of it, or we cannot say the
// sound came from here and the segment is left alone.
const LOCAL_ORIGIN_RATIO = 0.5

export function dropPhantomRemoteSpeech(
  segments: TranscriptSegment[],
  remoteRanges: Range[],
  micRanges: Range[],
  localLabel = 'You',
): TranscriptSegment[] {
  // No remote activity at all means the detection failed or the whole capture is
  // one-sided — either way every remote segment would look phantom. Do nothing.
  if (segments.length === 0 || remoteRanges.length === 0 || micRanges.length === 0) return segments

  // The whole rule rests on being able to exempt the local speaker, and
  // pinLocalSpeaker deliberately pins NOTHING when the answer is ambiguous. With
  // nobody labelled local, the local person's own turns look exactly like the
  // phantom case — they talk, the far end is silent, the mic is live — and every
  // one of them would be deleted. Without a known local speaker there is no rule.
  if (!segments.some(s => s.speakerLabel === localLabel)) return segments

  return segments.filter(seg => {
    if (seg.speakerLabel === localLabel) return true
    const dur = seg.endTime - seg.startTime
    if (dur <= 0) return true
    const span: Range = [seg.startTime, seg.endTime]

    const remote = remoteRanges.reduce((sum, r) => sum + overlap(span, r), 0)
    if (remote / dur > PHANTOM_REMOTE_RATIO) return true

    const mic = micRanges.reduce((sum, r) => sum + overlap(span, r), 0)
    return mic / dur < LOCAL_ORIGIN_RATIO
  })
}
