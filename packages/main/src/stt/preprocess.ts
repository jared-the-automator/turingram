import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { ffmpegPath } from '../ffmpegPath';

// Interior silence removal was REMOVED 2026-07-24. It used
//   silenceremove=start_periods=1:start_silence=0.3:start_threshold=-35dB
//              :stop_periods=-1:stop_duration=2:stop_threshold=-35dB
// and `stop_periods=-1` strips every silent stretch in the file, not just the
// leading one — measured, a 26.0 s recording came out at 17.9 s.
//
// That put the transcript on a different clock from the recording it came from.
// Every timestamp written to the database referred to the compressed audio, so
// seeking a retained WAV would land in the wrong place, and mic-channel speaker
// pinning (localSpeaker.ts) could not compare its ranges to segment times at all.
//
// The cost of keeping silence is that Deepgram bills it: a few cents per hour at
// $0.26/hr. Correct timestamps are worth more than that.

// Inherited from the old per-channel whisper path (whisper.ts extractChannel),
// where each channel was transcribed SEPARATELY and mic bleed really could
// produce duplicate text. That is no longer the architecture — both channels are
// folded to one mono file and transcribed once.
//
// Bleed is handled upstream by the WebRTC AEC in audio/linux.ts. Real
// speaker-to-mic measurement on this hardware: bleed -42.1 dBFS RMS without AEC,
// -69.2 dBFS with it, leaving residual bleed 45.9 dB below the remote's own
// channel. The gate contributes 0 dB of that; its one job is to mute the mic's
// own noise floor while the local speaker is silent.
//
// The threshold has to sit between that noise floor and real speech, and the
// old 0.02 (-34 dBFS) did not. Measured over a real 62-minute call
// (2026-07-30): mic noise floor around -80 dBFS, mic speech a median -41 dBFS
// RMS — so the gate's threshold sat 7 dB ABOVE the level of the local speaker's
// own voice, and with range=0 it cut every quiet syllable to absolute silence.
// That call lost 43% of the local speaker's words while the ungated remote
// channel transcribed more completely than Fireflies did. -60 dBFS (0.001) is
// 20 dB above the noise floor and 19 dB below speech, and range=0.06 attenuates
// rather than deletes, so a misfire costs volume instead of words.
const MIC_GATE = 'agate=threshold=0.001:ratio=4:attack=5:release=400:range=0.06';

// Builds the ffmpeg filter arguments. Exported so the stereo mixdown can be
// tested without invoking ffmpeg.
export function buildFilterArgs(channels: number): string[] {
  if (channels < 2) {
    // Mono capture: nothing to fold, just normalize.
    return ['-af', 'loudnorm'];
  }
  // Stereo: left = mic, right = system monitor. Gate the mic's noise floor,
  // bring BOTH channels to the same loudness, then fold to one channel.
  // normalize=0 stops amix from halving levels.
  //
  // The per-channel loudnorm is what keeps the local speaker audible. A laptop
  // mic and a conferencing app's output are not remotely level-matched: on a
  // real call the remote side ran 16.1 dB hotter than the local speaker
  // (-24.9 vs -41.1 dBFS RMS while each was talking). Summing that and
  // normalizing only the total preserves the gap, so the transcriber hears one
  // speaker up close and one across the room — and drops the far one's words.
  // Normalizing each channel to the same target first removes the gap;
  // R128 gating means the mic's long silences do not skew its measurement.
  //
  // Nothing here changes the duration — that is deliberate, so segment
  // timestamps stay on the same clock as the source recording.
  const graph = [
    '[0:a]channelsplit=channel_layout=stereo[l][r]',
    `[l]${MIC_GATE},loudnorm[lg]`,
    '[r]loudnorm[rg]',
    '[lg][rg]amix=inputs=2:duration=longest:normalize=0[m]',
    '[m]loudnorm[out]',
  ].join(';');
  return ['-filter_complex', graph, '-map', '[out]'];
}

// Prepares a recording for upload: trims silence, normalizes loudness, and
// ALWAYS emits mono.
//
// Mono output is a billing requirement, not a preference. Deepgram bills
// multichannel audio per channel — "if you process a 10-minute file with 2
// channels (stereo), you are billed for 20 minutes" — so submitting the stereo
// capture unchanged would turn $0.26/hr into $0.52/hr. (AssemblyAI, the previous
// provider, billed identically; this trap is not vendor-specific.)
//
// ponytail: folding to mono discards the free "this channel is the local user"
// signal that the old two-track path used to label speakers You vs Remote.
// Upgrade path when speaker attribution needs it: run silencedetect on the mic
// channel, then relabel whichever diarized cluster overlaps those ranges most
// as "You" — one extra ffmpeg pass, no extra API spend.
//
// Returns the _pre.wav path on success, or the original path if preprocessing
// fails. Callers must delete the returned path when it differs from the input.
export async function preprocessAudio(
  audioPath: string,
  meetingId: string,
  dataDir: string,
  channels: number,
  signal?: AbortSignal,
): Promise<string> {
  const recDir = path.join(dataDir, 'recordings');
  fs.mkdirSync(recDir, { recursive: true });
  const prePath = path.join(recDir, `${meetingId}_pre.wav`);

  try {
    await new Promise<void>((resolve, reject) => {
      const proc = spawn(ffmpegPath(), [
        '-i', audioPath,
        ...buildFilterArgs(channels),
        '-ar', '16000', '-ac', '1', '-y', prePath,
      ], { signal });
      proc.on('error', reject);
      proc.on('close', code => code === 0 ? resolve() : reject(new Error(`ffmpeg preprocess exit ${code}`)));
    });

    if (fs.statSync(prePath).size < 1024) {
      throw new Error('preprocessed output too small — audio may be empty');
    }
    return prePath;
  } catch (err) {
    console.error('[turingram] preprocessing failed, using original:', (err as Error).message);
    if (fs.existsSync(prePath)) fs.unlinkSync(prePath);
    return audioPath;
  }
}
