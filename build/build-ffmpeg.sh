#!/usr/bin/env bash
#
# Builds the minimal LGPL ffmpeg that Turingram ships.
#
# WHY BUILD RATHER THAN DOWNLOAD
#
# Every prebuilt binary that is easy to get is either the wrong licence or the
# wrong size. Verified 2026-08-01:
#   - @ffmpeg-installer/ffmpeg advertises LGPL-2.1 on the umbrella package, but
#     its win32-x64 and linux-x64 sub-packages are GPLv3. Bundling those would
#     put Turingram itself under the GPL.
#   - BtbN/FFmpeg-Builds does publish genuine LGPL win64 and linux64 statics,
#     but they are full builds: the win64-lgpl zip is 139 MB and the binary
#     inside is around 120 MB, which would more than double a 96 MB installer.
#   - BtbN publishes no macOS assets at all, and every popular macOS build
#     (evermeet, Homebrew's default formula) is configured --enable-gpl.
#
# Turingram never touches anything but PCM in a WAV container, so almost all of
# that weight is codecs it will never call. Building from source with
# --disable-everything and an explicit component list gives a binary that is
# both a fraction of the size and unambiguously LGPL-2.1, which is a licence
# that can be stated in one line without a lawyer.
#
# Usage: build/build-ffmpeg.sh <mac-arm64|mac-x64|win64|linux64> <output-path>

set -euo pipefail

TARGET="${1:?usage: build-ffmpeg.sh <mac-arm64|mac-x64|win64|linux64> <output-path>}"
OUT="${2:?usage: build-ffmpeg.sh <target> <output-path>}"

# Absolute before anything else: this script cds into the ffmpeg build tree, so
# a relative output path would be created there instead of in the caller's
# directory. It fails silently — the binary builds, the copy succeeds, and the
# caller finds nothing where it asked for the output.
case "$OUT" in
  /*) ;;
  *) OUT="$PWD/$OUT" ;;
esac

VERSION=7.1.1
TARBALL="ffmpeg-${VERSION}.tar.xz"
URL="https://ffmpeg.org/releases/${TARBALL}"
# sha256 of the official release tarball. Its detached .asc carries a good
# signature from the FFmpeg release signing key, fingerprint
# FCF986EA15E6E293A5644F10B4322F04D67658D8 — checked before pinning this, so the
# hash is anchored to upstream's key rather than to whatever the host served the
# first time someone ran this.
SHA256=733984395e0dbbe5c046abda2dc49a5544e7e0e1e2366bba849222ae9e3a03b1

WORK="${FFMPEG_BUILD_DIR:-$(mktemp -d)}"
mkdir -p "$WORK"

# The exact component list Turingram calls, and nothing else. Every entry below
# is reachable from a spawn site in packages/main/src; the smoke test at the
# bottom runs the real command shapes, so dropping something needed here fails
# the build instead of failing a user's first recording.
#
#   demuxers  wav (recordings), pcm_* (raw capture piped in on win/mac)
#   muxers    wav (output), null (silencedetect passes discard their audio)
#
# Note the pcm_* spelling: the configure component is pcm_s16le while the format
# name passed to -f is s16le. Configure accepts the wrong one without complaint
# and just builds a binary that cannot open the pipe.
#   filters   agate/loudnorm/amix/channelsplit  preprocess.ts
#             pan/silencedetect                 localSpeaker.ts, linux.ts
#             aformat/apad/join                 joinStereo, all three platforms
#             aresample                         every -ar 16000
#   lavfi+sine exist only so the smoke test can generate its own input.
COMPONENTS=(
  --enable-demuxer=wav,pcm_s16le,pcm_f32le,pcm_s24le,pcm_s32le,pcm_u8,pcm_f64le
  --enable-muxer=wav,null,pcm_s16le,pcm_f32le
  --enable-decoder=pcm_s16le,pcm_s16be,pcm_s24le,pcm_s32le,pcm_u8,pcm_f32le,pcm_f64le
  --enable-encoder=pcm_s16le,pcm_s24le,pcm_f32le
  --enable-protocol=file,pipe
  --enable-filter=aformat,anull,anullsink,anullsrc,aresample,asetnsamples,atrim,agate,amix,apad,channelmap,channelsplit,format,join,loudnorm,pan,silencedetect,silenceremove,volume,sine
  --enable-indev=lavfi
)

# --disable-version3 keeps every LGPLv3-only component out, so the result is
# LGPL-2.1-or-later rather than a mix that has to be described as v3.
# --disable-ffprobe is deliberate: wavDuration.ts reads WAV headers directly, so
# nothing shells out to ffprobe any more and there is no second binary to ship.
COMMON=(
  --disable-everything
  --disable-gpl --disable-nonfree --disable-version3
  --disable-doc --disable-htmlpages --disable-manpages --disable-podpages --disable-txtpages
  --disable-debug --disable-network --disable-autodetect --disable-iconv
  --disable-shared --enable-static --enable-small
  --enable-ffmpeg --disable-ffplay --disable-ffprobe
  --enable-avdevice
)

case "$TARGET" in
  # --disable-autodetect also switches off the AVFoundation framework and
  # pthreads, and the avfoundation indev needs both. Without them configure
  # drops the indev with only a WARNING, and the smoke test catches it.
  mac-arm64)
    PLATFORM=(--arch=arm64 --enable-avfoundation --enable-pthreads --enable-indev=avfoundation)
    BIN=ffmpeg ;;
  mac-x64)
    # macos-latest runners are Apple Silicon, so the Intel slice is a cross
    # build. No nasm needed: --disable-x86asm costs nothing when the only work
    # is resampling a 16 kHz mono stream.
    PLATFORM=(
      --arch=x86_64 --target-os=darwin --enable-cross-compile --disable-x86asm
      --cc="clang -arch x86_64" --extra-ldflags=-arch\ x86_64
      --enable-avfoundation --enable-pthreads --enable-indev=avfoundation
    )
    BIN=ffmpeg ;;
  win64)
    # Cross-compiled from Linux with mingw-w64 rather than built on a Windows
    # runner: no MSVC or MSYS2 to set up, and the Windows capture path pipes raw
    # PCM in from naudiodon, so it needs no input device at all.
    PLATFORM=(
      --arch=x86_64 --target-os=mingw32 --enable-cross-compile
      --cross-prefix=x86_64-w64-mingw32- --disable-x86asm
    )
    BIN=ffmpeg.exe ;;
  linux64)
    # linux.ts captures both channels with `-f pulse`, for the microphone and for
    # the sink monitor, so the pulse indev is as load-bearing here as avfoundation
    # is on macOS. --disable-autodetect above means libpulse is never picked up
    # implicitly: without the explicit --enable-libpulse, configure quietly builds
    # a binary with no pulse support and the recording dies at spawn.
    #
    # This target used to be validation-only — the .deb depended on the distro
    # ffmpeg — and needed no input device, because nothing it produced was ever
    # run. When Linux started bundling like the other two platforms, the shipped
    # binary inherited that empty device list. On 2026-08-05 it reached a real
    # meeting and recorded five hours of nothing. smoke-ffmpeg.sh now asserts the
    # device is present, which is the check that would have caught it.
    #
    # Costs a runtime link against libpulse.so.0, which is why the .deb declares
    # libpulse0. Build host needs libpulse-dev.
    PLATFORM=(--disable-x86asm --enable-libpulse --enable-indev=pulse)
    BIN=ffmpeg ;;
  *)
    echo "unknown target: $TARGET" >&2; exit 1 ;;
esac

cd "$WORK"
if [ ! -f "$TARBALL" ]; then
  echo "==> downloading $URL"
  curl -fsSL -o "$TARBALL" "$URL"
fi
echo "${SHA256}  ${TARBALL}" | shasum -a 256 -c -

SRC="$WORK/ffmpeg-${VERSION}"
rm -rf "$SRC"
tar xf "$TARBALL"

BUILD="$WORK/build-${TARGET}"
rm -rf "$BUILD"; mkdir -p "$BUILD"
cd "$BUILD"

echo "==> configuring $TARGET"
"$SRC/configure" "${COMMON[@]}" "${COMPONENTS[@]}" "${PLATFORM[@]}"

echo "==> building $TARGET"
make -j"$(getconf _NPROCESSORS_ONLN 2>/dev/null || echo 4)"

mkdir -p "$(dirname "$OUT")"
cp "$BUILD/$BIN" "$OUT"
chmod +x "$OUT"

# Distributing an LGPL binary carries obligations: convey the licence, and say
# where the corresponding source is. Both files go next to the binary and get
# picked up by bundledFfmpeg() in electron-builder.config.js, so they land in
# the installed app rather than only in this repo.
DEST="$(dirname "$OUT")"
cp "$SRC/COPYING.LGPLv2.1" "$DEST/FFMPEG-LICENSE.txt"
cat > "$DEST/FFMPEG-SOURCE.txt" <<EOF
Turingram bundles ffmpeg ${VERSION}, unmodified, under the GNU Lesser General
Public License version 2.1 or later. The full licence text is in
FFMPEG-LICENSE.txt beside this file.

Source:   ${URL}
sha256:   ${SHA256}

The bundled build is a subset of ffmpeg, not the stock one. It was configured
with the flags below, which is everything needed to reproduce it from the source
tarball above:

$(printf '  %s\n' "${COMMON[@]}" "${COMPONENTS[@]}" "${PLATFORM[@]}")

No ffmpeg source was modified. --disable-gpl and --disable-version3 are what
keep the result LGPL-2.1 rather than GPL, and no GPL-licensed component is
compiled in. Confirm on the shipped binary with: ffmpeg -version
EOF

echo "==> built $OUT ($(du -h "$OUT" | cut -f1))"
