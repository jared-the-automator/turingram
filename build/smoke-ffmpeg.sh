#!/usr/bin/env bash
#
# Runs the exact ffmpeg command shapes Turingram issues at runtime against a
# built binary. build-ffmpeg.sh compiles with --disable-everything and an
# explicit component list, so a filter or muxer left off that list produces a
# binary that looks fine, packages fine, installs fine, and then fails on a
# user's first recording. This is the step that turns that into a build failure.
#
# Usage: build/smoke-ffmpeg.sh <path-to-ffmpeg>

set -euo pipefail

FF="${1:?usage: smoke-ffmpeg.sh <path-to-ffmpeg>}"
[ -x "$FF" ] || { echo "not executable: $FF" >&2; exit 1; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

pass=0
run() {
  local what="$1"; shift
  if "$@" >"$TMP/log" 2>&1; then
    pass=$((pass + 1))
    echo "  ok    $what"
  else
    echo "  FAIL  $what"
    sed 's/^/        /' "$TMP/log" >&2
    exit 1
  fi
}

echo "==> $("$FF" -version 2>/dev/null | head -1)"

# Confirm the licence before anything else. A GPL build here means the wrong
# source got picked up somewhere, and shipping it would relicense the app.
if ! "$FF" -version 2>&1 | grep -q -- '--disable-gpl'; then
  echo "  FAIL  binary was not configured --disable-gpl" >&2
  "$FF" -version 2>&1 | sed 's/^/        /' >&2
  exit 1
fi
echo "  ok    configured --disable-gpl"
pass=$((pass + 1))

# The input device the capture path opens, which every other check below misses.
#
# Everything past this point feeds ffmpeg from `-f lavfi` or a raw pipe, because
# a CI runner has no microphone to record. That makes the whole suite blind to
# the one component a recording cannot start without, and it shipped exactly that
# on 2026-08-05: the linux64 build enabled only lavfi, so `-f pulse -i default`
# died instantly on launch, autostop never saw a silence event and could never
# fire, and the app recorded nothing for five hours before failing on stop.
#
# Asserting the device is COMPILED IN is as far as CI can go, and it is the half
# that was missing. Whether the sound server then hands over a stream is a
# runtime question no build machine can answer.
#
# Derived from the host rather than passed in, which is correct at every call
# site: the mac binary is smoke-tested on macos-latest, the win64 one on
# windows-latest under bash (never on the Linux box that cross-compiled it), and
# both Linux checks — the staged binary and the copy inside the .deb — on ubuntu.
case "$(uname -s)" in
  Darwin)         REQUIRED_INDEV=avfoundation ;;
  Linux)          REQUIRED_INDEV=pulse ;;
  MINGW*|MSYS*|CYGWIN*)
    # Windows capture is naudiodon: it opens WASAPI itself and pipes raw PCM in,
    # so ffmpeg needs no input device at all. The s16le pipe checks below are the
    # real coverage there.
    REQUIRED_INDEV= ;;
  *)              REQUIRED_INDEV= ;;
esac

has_indev() {
  # ` DE pulse           Pulse audio output` / ` D  lavfi           Libavfilter…`
  # The flag column is one or two of D, E and '.', and a few names carry an alias
  # after a comma, so match the name at a field boundary rather than substring.
  "$FF" -hide_banner -devices 2>/dev/null | grep -qE "^ *[DE.]{1,2} +$1([,[:space:]]|\$)"
}

for dev in lavfi ${REQUIRED_INDEV}; do
  if has_indev "$dev"; then
    echo "  ok    input device $dev is compiled in"
    pass=$((pass + 1))
  else
    echo "  FAIL  input device $dev is missing — build/build-ffmpeg.sh needs --enable-indev=$dev" >&2
    "$FF" -hide_banner -devices 2>&1 | sed 's/^/        /' >&2
    exit 1
  fi
done

# Stand-ins for a capture: mono is what each channel is recorded at, stereo is
# what joinStereo produces and what preprocess.ts is handed.
run "generate mono 16 kHz wav" \
  "$FF" -v error -f lavfi -i "sine=frequency=440:duration=2" -ar 16000 -ac 1 -y "$TMP/mic.wav"
run "generate second mono wav" \
  "$FF" -v error -f lavfi -i "sine=frequency=880:duration=3" -ar 16000 -ac 1 -y "$TMP/sys.wav"
run "generate stereo 16 kHz wav" \
  "$FF" -v error -f lavfi -i "sine=frequency=440:duration=2" -ar 16000 -ac 2 -y "$TMP/stereo.wav"

# audio/*.ts joinStereo, including the apad that linux.ts adds so a half-dead
# capture costs one channel instead of truncating the whole meeting.
run "joinStereo (aformat, join)" \
  "$FF" -v error -i "$TMP/mic.wav" -i "$TMP/sys.wav" \
    -filter_complex '[0:a]aformat=channel_layouts=mono[l];[1:a]aformat=channel_layouts=mono[r];[l][r]join=inputs=2:channel_layout=stereo[out]' \
    -map '[out]' -ar 16000 -ac 2 -y "$TMP/joined.wav"
run "joinStereo with apad (linux padding path)" \
  "$FF" -v error -i "$TMP/mic.wav" -i "$TMP/sys.wav" \
    -filter_complex '[0:a]aformat=channel_layouts=mono,apad=whole_dur=3.000[l];[1:a]aformat=channel_layouts=mono,apad=whole_dur=3.000[r];[l][r]join=inputs=2:channel_layout=stereo[out]' \
    -map '[out]' -ar 16000 -ac 2 -y "$TMP/padded.wav"

# stt/preprocess.ts buildFilterArgs, both branches.
run "preprocess mono (loudnorm)" \
  "$FF" -v error -i "$TMP/mic.wav" -af loudnorm -ar 16000 -ac 1 -y "$TMP/pre_mono.wav"
run "preprocess stereo (channelsplit, agate, loudnorm, amix)" \
  "$FF" -v error -i "$TMP/stereo.wav" \
    -filter_complex '[0:a]channelsplit=channel_layout=stereo[l][r];[l]agate=threshold=0.001:ratio=4:attack=5:release=400:range=0.06,loudnorm[lg];[r]loudnorm[rg];[lg][rg]amix=inputs=2:duration=longest:normalize=0[m];[m]loudnorm[out]' \
    -map '[out]' -ar 16000 -ac 1 -y "$TMP/pre_stereo.wav"

# stt/localSpeaker.ts — pan one channel out, measure silence, discard the audio.
run "localSpeaker (pan, silencedetect, null muxer)" \
  "$FF" -v error -i "$TMP/stereo.wav" \
    -af 'pan=mono|c0=c0,silencedetect=noise=-35dB:d=0.5' -f null -
run "silencedetect on capture (linux/mac -af path)" \
  "$FF" -v error -i "$TMP/mic.wav" -af 'silencedetect=noise=-35dB:d=2' -ar 16000 -ac 1 -y "$TMP/det.wav"

# audio/win.ts and audio/mac.ts feed raw PCM in over a pipe from naudiodon and
# the Swift helper respectively, so the raw demuxers have to be present.
run "encode raw s16le to a pipe" \
  bash -c "\"$FF\" -v error -f lavfi -i sine=frequency=440:duration=1 -f s16le -ar 44100 -ac 2 - > \"$TMP/raw.s16le\""
run "s16le raw pipe input (windows capture)" \
  bash -c "\"$FF\" -v error -f s16le -ar 44100 -ac 2 -i pipe:0 -ar 16000 -ac 1 -y \"$TMP/raw16.wav\" < \"$TMP/raw.s16le\""
run "encode raw f32le to a pipe" \
  bash -c "\"$FF\" -v error -f lavfi -i sine=frequency=440:duration=1 -f f32le -ar 48000 -ac 1 - > \"$TMP/raw.f32le\""
run "f32le raw pipe input (mac helper capture)" \
  bash -c "\"$FF\" -v error -f f32le -ar 48000 -ac 1 -i pipe:0 -ar 16000 -ac 1 -y \"$TMP/raw32.wav\" < \"$TMP/raw.f32le\""

# The joined file is what wavDuration.ts parses, so confirm it is a real RIFF
# with a plausible length rather than a zero-byte file that every step above
# happily wrote.
node -e "
const fs = require('fs');
const b = fs.readFileSync(process.argv[1]);
if (b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WAVE') {
  console.error('output is not a RIFF/WAVE file'); process.exit(1);
}
if (b.length < 16000 * 2 * 2) { console.error('output suspiciously short: ' + b.length); process.exit(1); }
" "$TMP/joined.wav"
echo "  ok    output parses as RIFF/WAVE"
pass=$((pass + 1))

echo "==> $pass checks passed"
