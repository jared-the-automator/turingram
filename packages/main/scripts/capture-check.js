#!/usr/bin/env node
// Verifies the mic-capture stage: drives the real LinuxAudioCapture against a
// real PipeWire graph, using virtual null-sink devices so nothing plays out of
// the speakers. Mic and system tracks carry known, distinct audio; the mic track
// carries synthetic bleed (attenuated + delayed copy of the system track) so the
// preprocess agate can be measured against it.
//
// Checks: EC module loads and unloads, default sink is restored, the join
// produces stereo at 16 kHz with signal on BOTH channels, and no 'error' event
// fires. Run it after any change to audio/linux.ts or stt/preprocess.ts.
//
//   npm run build --workspace=packages/main
//   node packages/main/scripts/capture-check.js /tmp/tg-check 24
//
// Requires <workdir>/audio/wildfires.mp3 (any speech file works):
//   mkdir -p /tmp/tg-check/audio && curl -sSLo /tmp/tg-check/audio/wildfires.mp3 https://assembly.ai/wildfires.mp3
//
// WARNING — this temporarily repoints the machine's default sink and source at
// virtual devices. It restores them on exit AND on SIGINT/SIGTERM, and refuses
// to save a virtual device as the "previous" default, because an earlier version
// without those guards was interrupted and left the box with no audio output.
// If a run is ever killed with -9, recover with:
//   pactl list modules short | grep -E 'tg_|turingram_ec' | cut -f1 | xargs -r -n1 pactl unload-module
//
// Usage: node capture-check.js <workdir> [seconds]

const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const DIST = require('path').resolve(__dirname, '..', 'dist');
const { LinuxAudioCapture } = require(path.join(DIST, 'audio/linux.js'));

const WORK = process.argv[2];
const SECONDS = Number(process.argv[3] || 20);
const AUDIO = path.join(WORK, 'audio');

const sh = (cmd) => execSync(cmd, { encoding: 'utf8' }).trim();
const shq = (cmd) => { try { return sh(cmd); } catch { return ''; } };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const loaded = [];
let prevSink = '', prevSource = '';

function loadModule(args) {
  const id = sh(`pactl load-module ${args}`);
  loaded.push(id);
  return id;
}

const VIRTUAL = /tg_sys|tg_micsrc|tg_mic|turingram_ec_/;

// Unload every virtual device this harness (or the app) may have left loaded.
function cleanVirtual() {
  for (const line of shq('pactl list modules short').split('\n')) {
    if (VIRTUAL.test(line)) shq(`pactl unload-module ${line.split('\t')[0]}`);
  }
  loaded.length = 0;
}

// Never restore a virtual device as the machine's default — fall back to the
// first real one PipeWire reports.
function realDevice(kind, name) {
  if (name && !VIRTUAL.test(name)) return name;
  const first = shq(`pactl list ${kind} short`).split('\n')
    .map(l => l.split('\t')[1])
    .find(n => n && !VIRTUAL.test(n) && !n.endsWith('.monitor'));
  return first || '';
}

function teardown() {
  cleanVirtual();
  // Resolve again after unloading: the defaults may have moved as devices died.
  const sink = realDevice('sinks', prevSink);
  const source = realDevice('sources', prevSource);
  if (sink) shq(`pactl set-default-sink ${sink}`);
  if (source) shq(`pactl set-default-source ${source}`);
}

// Per-channel RMS (dB) of a wav, optionally over a [ss, ss+t] window.
function channelRms(file, ss, t) {
  const win = ss === undefined ? '' : `-ss ${ss} -t ${t} `;
  // astats reports at info level — do NOT pass -v error here or the numbers vanish.
  const out = execSync(
    `ffmpeg -hide_banner -nostats ${win}-i ${JSON.stringify(file)} -af astats=metadata=1:reset=0 -f null - 2>&1`,
    { encoding: 'utf8' }
  );
  const rms = [];
  for (const line of out.split('\n')) {
    const m = line.match(/RMS level dB:\s*(-?[\d.]+|-inf)/);
    if (m) rms.push(m[1] === '-inf' ? -Infinity : parseFloat(m[1]));
  }
  // astats prints per-channel blocks then an "Overall" block; drop the overall.
  return rms.length > 1 ? rms.slice(0, -1) : rms;
}

function probe(file) {
  const out = sh(`ffprobe -v error -show_entries stream=channels,sample_rate -show_entries format=duration -of default=nw=1 ${JSON.stringify(file)}`);
  const val = (k) => {
    const l = out.split('\n').find(x => x.startsWith(`${k}=`));
    return l ? l.split('=')[1] : '';
  };
  return {
    channels: parseInt(val('channels') || '0', 10),
    sampleRate: parseInt(val('sample_rate') || '0', 10),
    duration: parseFloat(val('duration') || '0'),
  };
}

function play(file, device) {
  return spawn('paplay', ['--device', device, file], { stdio: 'ignore' });
}

async function main() {
  fs.mkdirSync(AUDIO, { recursive: true });
  const src = path.join(AUDIO, 'wildfires.mp3');
  if (!fs.existsSync(src)) throw new Error(`missing sample: ${src}`);

  // Two distinct speaker segments from the sample; sysTrack is the "remote party",
  // micTrack is the local speaker plus a quiet, delayed copy of sysTrack (bleed).
  const micClean = path.join(AUDIO, 'mic_clean.wav');
  const sysTrack = path.join(AUDIO, 'sys.wav');
  const micTrack = path.join(AUDIO, 'mic_bleed.wav');
  const D = SECONDS;
  const HALF = D / 2;
  // Local speaker talks for the first half then goes quiet. The quiet half is the
  // window where bleed matters — a gate that never closes proves nothing.
  sh(`ffmpeg -v error -y -ss 0 -t ${D} -i ${src} -af "volume=enable='gte(t,${HALF})':volume=0" -ar 48000 -ac 2 ${micClean}`);
  sh(`ffmpeg -v error -y -ss 120 -t ${D} -i ${src} -ar 48000 -ac 2 ${sysTrack}`);
  // bleed: -20 dB, delayed 120 ms — what a speaker-to-mic path looks like.
  sh(`ffmpeg -v error -y -i ${micClean} -i ${sysTrack} -filter_complex ` +
     `"[1:a]adelay=120|120,volume=0.1[b];[0:a][b]amix=inputs=2:duration=first:normalize=0[out]" ` +
     `-map "[out]" -ar 48000 -ac 2 ${micTrack}`);

  // Clear anything a previous interrupted run left behind FIRST — otherwise we
  // "save" a virtual device as the machine's real routing and restore it at the
  // end, leaving the box with no audio output.
  cleanVirtual();
  prevSink = realDevice('sinks', sh('pactl get-default-sink'));
  prevSource = realDevice('sources', sh('pactl get-default-source'));
  console.log(`saved routing: sink=${prevSink} source=${prevSource}`);

  // Virtual graph: tg_sys is where "system audio" plays; tg_micsrc.monitor is
  // remapped to tg_mic so the capture code sees a non-monitor microphone.
  loadModule('module-null-sink sink_name=tg_sys sink_properties=device.description=tg_sys');
  loadModule('module-null-sink sink_name=tg_micsrc sink_properties=device.description=tg_micsrc');
  loadModule('module-remap-source master=tg_micsrc.monitor source_name=tg_mic source_properties=device.description=tg_mic');
  sh('pactl set-default-sink tg_sys');
  sh('pactl set-default-source tg_mic');
  await sleep(500);

  const errors = [];
  const cap = new LinuxAudioCapture(WORK);
  cap.on('error', (e) => errors.push(String(e)));
  cap.on('autostop', () => errors.push('unexpected autostop'));

  const t0 = Date.now();
  await cap.start();

  const ecActive = shq('pactl list modules short').includes('turingram_ec_source');
  const sinkDuringCapture = shq('pactl get-default-sink');
  console.log(`echo-cancel active: ${ecActive}; default sink during capture: ${sinkDuringCapture}`);

  // Play both tracks concurrently. System audio goes to the *current* default
  // sink (the EC sink when AEC is up), mic audio into the virtual mic's feeder.
  await sleep(400);
  const pSys = play(sysTrack, ecActive ? 'turingram_ec_sink' : 'tg_sys');
  const pMic = play(micTrack, 'tg_micsrc');
  await new Promise(r => { let n = 0; const done = () => (++n === 2) && r(); pSys.on('close', done); pMic.on('close', done); });
  await sleep(300);

  const result = await cap.stop();
  const wall = ((Date.now() - t0) / 1000).toFixed(1);

  const info = probe(result.audioPath);
  const rms = channelRms(result.audioPath);
  console.log(`\ncapture: ${result.audioPath}`);
  console.log(`  isStereo=${result.isStereo} channels=${info.channels} rate=${info.sampleRate} dur=${info.duration.toFixed(1)}s (wall ${wall}s)`);
  console.log(`  per-channel RMS dB: ${rms.map(v => v.toFixed(1)).join(', ')}`);
  console.log(`  errors: ${errors.length ? errors.join(' | ') : 'none'}`);

  const ecAfter = shq('pactl list modules short').includes('turingram_ec_source');
  const sinkAfter = shq('pactl get-default-sink');
  console.log(`  EC unloaded after stop: ${!ecAfter}; default sink restored: ${sinkAfter === prevSink || sinkAfter === 'tg_sys'} (${sinkAfter})`);

  // Preprocess: stereo → gated mono. Compare against the same fold WITHOUT the
  // gate to measure what the gate actually removes.
  const { preprocessAudio } = require(path.join(DIST, 'stt/preprocess.js'));
  const pre = await preprocessAudio(result.audioPath, 'e2e-capture', WORK, info.channels, undefined);
  const preInfo = probe(pre);
  console.log(`\npreprocess -> ${pre}`);
  console.log(`  channels=${preInfo.channels} dur=${preInfo.duration.toFixed(1)}s rms=${channelRms(pre).map(v => v.toFixed(1)).join(', ')}`);

  // Isolate the gate's effect: gate the mic channel alone vs leave it raw.
  const gated = path.join(AUDIO, 'mic_gated.wav');
  const raw = path.join(AUDIO, 'mic_raw.wav');
  const sysRaw = path.join(AUDIO, 'sys_raw.wav');
  sh(`ffmpeg -v error -y -i ${JSON.stringify(result.audioPath)} -af "pan=mono|c0=c0,agate=threshold=0.02:ratio=9:attack=10:release=250:range=0" ${gated}`);
  sh(`ffmpeg -v error -y -i ${JSON.stringify(result.audioPath)} -af "pan=mono|c0=c0" ${raw}`);
  sh(`ffmpeg -v error -y -i ${JSON.stringify(result.audioPath)} -af "pan=mono|c0=c1" ${sysRaw}`);
  const w = [SECONDS / 2 + 1, SECONDS / 2 - 2];  // the local-silent window
  console.log(`  full file  — mic(L) raw=${channelRms(raw)[0].toFixed(1)} gated=${channelRms(gated)[0].toFixed(1)} sys(R)=${channelRms(sysRaw)[0].toFixed(1)} dB`);
  console.log(`  local-silent window (${w[0]}s +${w[1]}s):`);
  console.log(`    mic(L) raw=${channelRms(raw, ...w)[0].toFixed(1)} gated=${channelRms(gated, ...w)[0].toFixed(1)} sys(R)=${channelRms(sysRaw, ...w)[0].toFixed(1)} dB`);

  // Isolate the gate WITHOUT AEC: same filter over the synthetic mic track, whose
  // bleed is known (-20 dB, 120 ms delayed). AEC in the live path cancels a
  // synthetic, perfectly-correlated bleed far better than a real room would, so
  // this is the honest lower bound on what the gate alone contributes.
  const noAecRaw = path.join(AUDIO, 'noaec_raw.wav');
  const noAecGated = path.join(AUDIO, 'noaec_gated.wav');
  sh(`ffmpeg -v error -y -i ${micTrack} -af "pan=mono|c0=c0" ${noAecRaw}`);
  sh(`ffmpeg -v error -y -i ${micTrack} -af "pan=mono|c0=c0,agate=threshold=0.02:ratio=9:attack=10:release=250:range=0" ${noAecGated}`);
  console.log(`  gate alone, no AEC, same window: raw=${channelRms(noAecRaw, ...w)[0].toFixed(1)} gated=${channelRms(noAecGated, ...w)[0].toFixed(1)} dB`);

  console.log(`\nARTIFACTS: capture=${result.audioPath} pre=${pre}`);
}

// An interrupt must not leave the machine routed to a null sink.
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(sig, () => { teardown(); process.exit(130); });
}

main()
  .catch(e => { console.error('FAILED:', e && e.stack || e); process.exitCode = 1; })
  .finally(() => { teardown(); console.log(`\nrouting now: sink=${shq('pactl get-default-sink')} source=${shq('pactl get-default-source')}`); });
