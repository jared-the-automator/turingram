import type { TranscriptSegment } from '@turingyde/transcript-core'

// The recorded wall time routinely outlives the conversation: autostop waits
// through two minutes of silence, and an app that holds the mic open after the
// call (Zoom does) defeats silence detection entirely — one real meeting logged
// 76 minutes for 62 minutes of talking. The transcript knows when the talking
// stopped; trust it. Segment timestamps are post-silence-removal, so this can
// undershoot slightly, never overshoot. Returns 0 when there are no segments.
export function speechExtentSec(segments: TranscriptSegment[]): number {
  return Math.round(segments.reduce((max, s) => Math.max(max, s.endTime), 0))
}

// Only still-anonymous diarized labels are safe to rename from model inference.
// "You" (the pinned local speaker) and anything a user typed must never be
// overwritten by a guess.
const ANONYMOUS_LABEL = /^Speaker \d+$/i

export function inferableSpeakerRenames(
  speakerNames: Record<string, string>,
): Record<string, string> {
  const map: Record<string, string> = {}
  for (const [label, name] of Object.entries(speakerNames)) {
    if (ANONYMOUS_LABEL.test(label.trim()) && name.trim()) map[label.trim()] = name.trim()
  }
  return map
}
