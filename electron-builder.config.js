const fs = require('fs');
const path = require('path');

// ffmpeg is bundled when CI (or a developer) has staged a binary at
// packages/main/resources/. Conditional because a Linux build with no staged
// binary would otherwise print "file source doesn't exist" on every run — the
// same warning that moved the mac audio helper into the mac block. When it is
// absent, ffmpegPath.ts falls back to whatever is on PATH, which is the
// behavior every build had before bundling existed.
// The two licence files ride along with the binary, never separately: shipping
// an LGPL binary means conveying the licence and saying where the corresponding
// source is, and build/build-ffmpeg.sh writes both next to the binary for
// exactly that. Bundling the binary without them would be a licence violation.
function bundledFfmpeg() {
  const name = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  const dir = path.join(__dirname, 'packages/main/resources');
  if (!fs.existsSync(path.join(dir, name))) return [];
  return ['FFMPEG-LICENSE.txt', 'FFMPEG-SOURCE.txt'].reduce((out, f) => {
    if (!fs.existsSync(path.join(dir, f))) {
      throw new Error(`bundling ffmpeg without ${f} would violate the LGPL — run build/build-ffmpeg.sh`);
    }
    return out.concat({ from: path.join(dir, f), to: f });
  }, [{ from: path.join(dir, name), to: name }]);
}

// A real Developer ID takes over the moment the certificate and the notarytool
// credentials are both in the environment; until then the build is ad-hoc signed.
// Written as one switch rather than two so the two halves cannot drift: signing
// with a real identity and NOT notarizing produces a DMG that still trips
// Gatekeeper, which looks identical to the free build and costs $99 a year.
const hasSigningCert = !!process.env.CSC_LINK || !!process.env.CSC_NAME;
const hasNotaryCreds =
  (!!process.env.APPLE_API_KEY && !!process.env.APPLE_API_KEY_ID && !!process.env.APPLE_API_ISSUER) ||
  (!!process.env.APPLE_ID && !!process.env.APPLE_APP_SPECIFIC_PASSWORD && !!process.env.APPLE_TEAM_ID);
const releaseSigning = hasSigningCert && hasNotaryCreds;

module.exports = {
  appId: 'com.turingyde.turingram',
  productName: 'Turingram',
  directories: { output: 'release' },
  asarUnpack: ['**/better-sqlite3/**', '**/naudiodon/**'],
  files: [
    'package.json',
    'packages/main/dist/**/*',
    '!packages/main/dist/**/*.d.ts',
    'node_modules/**/*',
    '!node_modules/.cache',
    '!node_modules/.bin',
    '!**/node_modules/typescript/**',
    '!**/node_modules/vitest/**',
    '!**/node_modules/@vitest/**',
    '!**/node_modules/vite/**',
    '!**/node_modules/@vitejs/**',
    '!**/node_modules/electron-builder/**',
  ],
  linux: {
    target: ['AppImage', 'deb'],
    category: 'Utility',
    icon: 'packages/main/assets/icon-512.png',
    // Keep the installed .desktop file's name in step with desktopName in
    // package.json — Electron uses that as the WM_CLASS / app_id, and without
    // the pair matching, desktop environments cannot associate the running
    // window with its launcher entry.
    syncDesktopName: true,
  },
  // depends belongs to the deb target, not to `linux` — electron-builder 26
  // validates the linux block against a closed schema and rejects the whole
  // config if an unknown key appears there.
  //
  // Everything electron-builder infers for Electron itself, plus pulseaudio-utils
  // for the `pactl` that linux.ts and meetingDetector.ts both drive. Undeclared,
  // the package installs cleanly onto a machine without it and then fails at the
  // first recording — invisible on a dev box where it is always present.
  //
  // ffmpeg is deliberately NOT a dependency: Linux bundles it like the other two
  // platforms now do. Declaring it would make apt pull the full distro ffmpeg and
  // its dependency tree to satisfy something already inside the package, and it
  // would do nothing for the AppImage, which takes no depends at all and would
  // still fail on a machine without ffmpeg on PATH.
  // libpulse0 is the bundled ffmpeg's own dependency, not Electron's: the Linux
  // build enables the pulse indev because linux.ts captures with `-f pulse`, and
  // that links against libpulse.so.0. Missing, the binary does not start at all,
  // which is a worse failure than the one bundling was meant to fix.
  deb: {
    depends: [
      'libgtk-3-0', 'libnotify4', 'libnss3', 'libxss1', 'libxtst6', 'xdg-utils',
      'libatspi2.0-0', 'libuuid1', 'libsecret-1-0',
      'pulseaudio-utils', 'libpulse0',
    ],
  },
  extraResources: [
    { from: 'packages/renderer/dist', to: 'renderer', filter: ['**/*'] },
    { from: 'packages/main/assets', to: 'icons', filter: ['*.png'] },
    ...bundledFfmpeg(),
    // Transcription is API-driven as of 2026-07-22 — the whisper-cli binary and
    // the pyannote diarize.py script are no longer shipped. That removes the
    // ~640 MB of bundled models and the Python venv bootstrap from the installer.
  ],
  win: {
    target: ['nsis'],
    icon: 'packages/main/assets/icon-512.png',
  },
  mac: {
    // Both architectures, as separate binaries. electron-builder otherwise
    // defaults to the build host's arch, and macos-latest is Apple Silicon,
    // which silently shipped an arm64-only DMG that will not launch on an
    // Intel Mac.
    target: [{ target: 'dmg', arch: ['x64', 'arm64'] }],
    category: 'public.app-category.productivity',
    entitlements: 'packages/main/entitlements.mac.plist',
    entitlementsInherit: 'packages/main/entitlements.mac.plist',
    // Without NSMicrophoneUsageDescription, macOS terminates the app the moment
    // it asks for the microphone. The entitlement above grants the capability;
    // this string is what TCC shows the user, and its absence is fatal rather
    // than cosmetic. NSAudioCaptureUsageDescription is the ScreenCaptureKit
    // system-audio prompt and NSScreenCaptureUsageDescription the screen-recording
    // one, which is the permission SCK actually gates system audio behind.
    //
    // Both halves of the product are in here because a tester who denies either
    // prompt gets a half-recorded meeting and no explanation.
    extendInfo: {
      NSMicrophoneUsageDescription:
        'Turingram records your side of the meeting from your microphone, so your own words are transcribed exactly rather than guessed from the room.',
      NSAudioCaptureUsageDescription:
        'Turingram records the other participants from your system audio, on a separate channel from your microphone, so the speakers can be told apart.',
      NSScreenCaptureUsageDescription:
        'macOS grants system audio capture under Screen Recording. Turingram records audio only and never captures your screen.',
    },
    // The Swift helper calls ScreenCaptureKit's audio API, which is macOS 13+.
    // Declared so macOS refuses to launch on an older release rather than running
    // an app whose system-audio half dies on first use — that failure is quiet
    // enough already without an OS-version cause hiding underneath it.
    minimumSystemVersion: '13.0',
    // Ad-hoc until a certificate shows up. TCC keys its grants to a binary's
    // identity, and an unsigned bundle gets a fresh one on every build, so a
    // tester re-grants the microphone each time and any grant they gave the
    // previous build is silently dead. Ad-hoc signing gives it one stable
    // identity per build without an Apple Developer account. It does NOT satisfy
    // Gatekeeper: the DMG still needs Open Anyway on first launch.
    ...(releaseSigning ? { notarize: true } : { identity: '-' }),
    // ffmpeg and the Swift helper arrive through extraResources, and
    // electron-builder signs exactly what this names and nothing more —
    // MacTargetHelper hands `config.binaries` straight to the signer. Both are
    // lipo-merged universal binaries and Apple Silicon refuses to execute
    // unsigned arm64 code, so omitting them means the app launches fine and then
    // records nothing at all. Relative paths resolve from the .app root.
    binaries: [
      'Contents/Resources/ffmpeg',
      'Contents/Resources/turingram-audio-helper',
    ],
    // macOS Swift audio helper (built separately via `npm run build-swift`).
    // Mac-only, so declared here — in the top-level extraResources it printed a
    // "file source doesn't exist" warning on every Linux build.
    extraResources: [
      { from: 'packages/main/resources/turingram-audio-helper', to: 'turingram-audio-helper', filter: ['*'] },
    ],
  },
};
