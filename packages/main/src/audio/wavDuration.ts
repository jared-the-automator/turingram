import fs from 'fs';

// Replaces a `spawn('ffprobe', ...)` that was the last place Turingram shelled
// out to a bare binary name. ffprobe ships with ffmpeg on a Linux distro, so on
// a dev box it always resolved; in a packaged build it is absent, the spawn
// errored, the caller swallowed it as duration 0, and joinStereo lost its
// padding — which is the exact failure that padding was added to prevent. A
// truncated recording would have come back with nothing to say it was.
//
// Every file this reads is a WAV that Turingram itself wrote with pcm_s16le, so
// the duration is a header field. No subprocess, no timing, and exact rather
// than parsed out of a formatted string.

const RIFF = 0x52494646; // 'RIFF'
const WAVE = 0x57415645; // 'WAVE'
const HEADER_BYTES = 12;
const CHUNK_HEADER_BYTES = 8;

/**
 * Duration of a WAV file in seconds, or 0 if the file is missing, truncated, or
 * not a WAV. Returning 0 rather than throwing keeps the previous contract: the
 * caller treats it as "unknown" and skips padding.
 */
export function wavDurationSec(file: string): number {
  let fd: number | undefined;
  try {
    fd = fs.openSync(file, 'r');
    const head = Buffer.alloc(HEADER_BYTES);
    if (fs.readSync(fd, head, 0, HEADER_BYTES, 0) < HEADER_BYTES) return 0;
    if (head.readUInt32BE(0) !== RIFF || head.readUInt32BE(8) !== WAVE) return 0;

    const size = fs.fstatSync(fd).size;
    let byteRate = 0;
    let pos = HEADER_BYTES;
    const chunk = Buffer.alloc(CHUNK_HEADER_BYTES);

    // Walk the chunk list rather than assuming fmt is first and data is second.
    // ffmpeg writes a LIST/INFO chunk between them when it has metadata to
    // record, and a hardcoded offset would read that as the samples.
    while (pos + CHUNK_HEADER_BYTES <= size) {
      if (fs.readSync(fd, chunk, 0, CHUNK_HEADER_BYTES, pos) < CHUNK_HEADER_BYTES) return 0;
      const id = chunk.toString('ascii', 0, 4);
      const len = chunk.readUInt32LE(4);
      const body = pos + CHUNK_HEADER_BYTES;

      if (id === 'fmt ' && len >= 16) {
        const fmt = Buffer.alloc(16);
        if (fs.readSync(fd, fmt, 0, 16, body) < 16) return 0;
        byteRate = fmt.readUInt32LE(8);
      } else if (id === 'data') {
        if (byteRate <= 0) return 0;
        // A capture killed mid-write leaves the declared length at whatever was
        // reserved, which is larger than what is on disk. Trust the file.
        const actual = Math.min(len, Math.max(0, size - body));
        return actual / byteRate;
      }

      // Chunks are word-aligned: an odd length carries a pad byte that is not
      // counted in the length field.
      pos = body + len + (len % 2);
    }
    return 0;
  } catch {
    return 0;
  } finally {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch { /* already gone */ }
    }
  }
}
