#!/usr/bin/env node
// Measures REAL speaker-to-mic bleed on this machine's actual hardware, and how
// much of it the WebRTC AEC in LinuxAudioCapture removes. Nobody speaks during
// the test, so everything in the mic channel is bleed + room noise.
//
//   baseline : mic only, no playback        -> room noise floor
//   run A    : playback + raw mic, no AEC   -> bleed as the hardware hears it
//   run B    : playback + LinuxAudioCapture -> bleed after WebRTC AEC
//
// PLAYS AUDIO OUT OF THE SPEAKERS — that is the point, and it is the only way to
// measure real speaker-to-mic bleed. Sets volume to 50% and restores it on exit.
// Ask before running it on someone's machine.
//
//   npm run build --workspace=packages/main
//   node packages/main/scripts/acoustic-check.js /tmp/tg-check 20
//
// Requires <workdir>/audio/remote.wav (any speech file).
//
// Baseline result on the dev laptop, 2026-07-24 (50% volume, nobody speaking):
//   room noise floor      -46.0 dBFS RMS
//   bleed without AEC     -42.1 dBFS RMS
//   bleed with AEC        -69.2 dBFS RMS   -> 26.8 dB of suppression
//   residual bleed sits 45.9 dB below the remote's own channel
// Read that 26.8 dB as the whole module's effect, not pure echo cancellation:
// the output lands BELOW the room noise floor, so webrtc.noise_suppression=1 is
// doing part of it. That is what production runs, so the 45.9 dB figure holds
// either way — just don't quote 26.8 dB as an AEC-only number.
// Conclusion: the WebRTC module is what makes the fold-to-mono safe. The agate
// in preprocess.ts contributes 0 dB to this — see the comment on MIC_GATE.
//
// Usage: node acoustic-check.js <workdir> [seconds]

const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const DIST = require('path').resolve(__dirname, '..', 'dist');
const { LinuxAudioCapture, cleanupStaleEchoCancel } = require(path.join(DIST, 'audio/linux.js'));

const WORK = process.argv[2];
const SECONDS = Number(process.argv[3] || 20);
const AUDIO = path.join(WORK, 'audio');
const GATE = 'agate=threshold=0.02:ratio=9:attack=10:release=250:range=0';

const sh = (c) => execSync(c, { encoding: 'utf8' }).trim();
const shq = (c) => { try { return sh(c); } catch { return ''; } };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

let origVolume = '';
const SINK = shq('pactl get-default-sink');
const MIC = shq('pactl get-default-source');

function restore() {
  if (origVolume) shq(`pactl set-sink-volume ${SINK} ${origVolume}`);
  for (const line of shq('pactl list modules short').split('\n')) {
    if (line.includes('turingram_ec_')) shq(`pactl unload-module ${line.split('\t')[0]}`);
  }
  shq(`pactl set-default-sink ${SINK}`);
  shq(`pactl set-default-source ${MIC}`);
}

// RMS + peak dBFS of a file (optionally one channel, optionally a time window).
function levels(file, { ss, t, chan, filter } = {}) {
  const pre = [];
  if (chan !== undefined) pre.push(`pan=mono|c0=c${chan}`);
  if (filter) pre.push(filter);
  const af = pre.length ? `-af "${pre.join(',')},astats=metadata=1:reset=0"` : '-af astats=metadata=1:reset=0';
  const win = ss === undefined ? '' : `-ss ${ss} -t ${t} `;
  const out = execSync(`ffmpeg -hide_banner -nostats ${win}-i ${JSON.stringify(file)} ${af} -f null - 2>&1`, { encoding: 'utf8' });
  const grab = (label) => {
    const m = out.match(new RegExp(`${label}:\\s*(-?[\\d.]+|-inf)`));
    return m ? (m[1] === '-inf' ? -Infinity : parseFloat(m[1])) : NaN;
  };
  return { rms: grab('RMS level dB'), peak: grab('Peak level dB') };
}

const fmt = (v) => (v === -Infinity ? '-inf' : v.toFixed(1));

function recordRaw(dest, seconds) {
  return new Promise((resolve, reject) => {
    const p = spawn('ffmpeg', ['-v', 'error', '-f', 'pulse', '-i', MIC, '-t', String(seconds),
      '-ar', '16000', '-ac', '1', '-y', dest]);
    p.on('error', reject);
    p.on('close', c => c === 0 ? resolve() : reject(new Error(`ffmpeg mic exit ${c}`)));
  });
}

function play(file, device) {
  return spawn('paplay', ['--device', device, file], { stdio: 'ignore' });
}

async function main() {
  fs.mkdirSync(AUDIO, { recursive: true });
  const remote = path.join(AUDIO, 'remote.wav');
  if (!fs.existsSync(remote)) throw new Error(`missing ${remote}`);
  const clip = path.join(AUDIO, 'acoustic_remote.wav');
  sh(`ffmpeg -v error -y -t ${SECONDS} -i ${remote} -ar 48000 -ac 2 ${clip}`);

  await cleanupStaleEchoCancel();
  origVolume = (shq(`pactl get-sink-volume ${SINK}`).match(/(\d+)%/) || [])[1];
  origVolume = origVolume ? `${origVolume}%` : '';
  console.log(`sink=${SINK}\nmic=${MIC}\nsaved volume=${origVolume || '(unknown)'} -> setting 50%`);
  sh(`pactl set-sink-volume ${SINK} 50%`);

  // 1. Room noise floor — nothing playing.
  const base = path.join(AUDIO, 'baseline_mic.wav');
  await recordRaw(base, 5);
  const baseL = levels(base);
  console.log(`\n1. room noise floor        rms=${fmt(baseL.rms)} peak=${fmt(baseL.peak)} dBFS`);

  // 2. Real acoustic bleed, no AEC.
  const rawMic = path.join(AUDIO, 'bleed_noaec.wav');
  const pA = play(clip, SINK);
  await sleep(300);
  await recordRaw(rawMic, SECONDS - 1);
  await new Promise(r => pA.on('close', r));
  const noAec = levels(rawMic);
  const noAecGated = levels(rawMic, { filter: GATE });
  console.log(`2. bleed, NO AEC           rms=${fmt(noAec.rms)} peak=${fmt(noAec.peak)} dBFS   (gated: ${fmt(noAecGated.rms)})`);

  await sleep(500);

  // 3. Real acoustic bleed through the app's own capture path (AEC active).
  const cap = new LinuxAudioCapture(WORK);
  const errors = [];
  cap.on('error', e => errors.push(String(e)));
  await cap.start();
  const ecActive = shq('pactl list modules short').includes('turingram_ec_source');
  await sleep(400);
  const pB = play(clip, shq('pactl get-default-sink'));
  await new Promise(r => pB.on('close', r));
  await sleep(300);
  const res = await cap.stop();

  const micCh = levels(res.audioPath, { chan: 0 });
  const micChGated = levels(res.audioPath, { chan: 0, filter: GATE });
  const sysCh = levels(res.audioPath, { chan: 1 });
  console.log(`3. bleed, AEC=${ecActive}      rms=${fmt(micCh.rms)} peak=${fmt(micCh.peak)} dBFS   (gated: ${fmt(micChGated.rms)})`);
  console.log(`   remote on sys channel   rms=${fmt(sysCh.rms)} peak=${fmt(sysCh.peak)} dBFS`);
  console.log(`   stereo=${res.isStereo} errors=${errors.length ? errors.join('|') : 'none'}`);

  console.log(`\n--- result ---`);
  console.log(`AEC cancellation          ${fmt(noAec.rms - micCh.rms)} dB`);
  console.log(`bleed below remote        ${fmt(sysCh.rms - micCh.rms)} dB (post-AEC, as mixed to mono)`);
  console.log(`bleed above room floor    ${fmt(micCh.rms - baseL.rms)} dB (0 = AEC took it to the noise floor)`);
  console.log(`gate's contribution       ${fmt(micCh.rms - micChGated.rms)} dB`);
  console.log(`\nARTIFACT: ${res.audioPath}`);
}

for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => { restore(); process.exit(130); });
main()
  .catch(e => { console.error('FAILED:', (e && e.stack) || e); process.exitCode = 1; })
  .finally(() => { restore(); console.log(`\nvolume restored: ${shq(`pactl get-sink-volume ${SINK}`).match(/(\d+%)/)?.[1]}, sink=${shq('pactl get-default-sink')}`); });
