import { randomUUID } from 'crypto'
import fs from 'fs/promises'
import { createReadStream } from 'fs'
import https from 'https'
import type { TranscriptSegment } from '@turingyde/transcript-core'

// Deepgram pre-recorded transcription. Driven over plain REST rather than
// @deepgram/sdk: the request is one POST with the audio as the body and every
// option in the query string, so the SDK would buy nothing and cost another
// ESM-only dependency in a CommonJS main process (see the `new Function` import
// hack gemini.ts needs for @google/genai).
const ENDPOINT = 'https://api.deepgram.com/v1/listen'

// Nova-3 monolingual, pre-recorded, pay-as-you-go: $0.0043/min = $0.26/hr, with
// speaker diarization included (it is a paid add-on for STREAMING only).
// 'nova-3-general' multilingual is $0.0052/min = $0.31/hr — do not switch
// without re-costing.
const MODEL = 'nova-3'

// Deepgram bills MULTICHANNEL AUDIO PER CHANNEL — "if you process a 10-minute
// file with 2 channels (stereo), you are billed for 20 minutes". preprocessAudio()
// always emits mono for exactly this reason; a stereo upload silently doubles
// $0.26/hr to $0.52/hr. Identical trap to AssemblyAI's.
//
// Key Terms are capped at 500 tokens across ALL keyterms per request, and the
// API hard-errors past it rather than truncating. Budget conservatively: cap the
// term count and drop anything long enough to be several tokens on its own.
const MAX_KEYTERMS = 100
const MAX_KEYTERM_LEN = 50

// Word as returned with diarize=true. Times are SECONDS (AssemblyAI reports
// milliseconds — do not copy a /1000 conversion over from assemblyai.ts).
export interface DeepgramWord {
  word: string
  punctuated_word?: string
  start: number
  end: number
  speaker?: number
}

// Deepgram labels speakers 0,1,2…; the rest of the app (agentHook, the UI,
// assign-speakers) expects "Speaker 1"-style labels.
export function normalizeSpeaker(raw: number | null | undefined): string {
  const n = Number(raw)
  return Number.isFinite(n) && n >= 0 ? `Speaker ${n + 1}` : 'Speaker 1'
}

// Collapses the flat word list into one segment per speaker turn. This is the
// only lossy part of the integration, so it is what the tests pin.
//
// Built from words[] rather than the `utterances` response object because the
// word shape is documented (start/end in seconds, speaker, punctuated_word) and
// grouping here keeps a single code path we control.
export function groupWordsBySpeaker(
  words: DeepgramWord[] | null | undefined,
  meetingId: string,
  fallbackText = '',
): TranscriptSegment[] {
  const list = (words ?? []).filter(w => String(w?.punctuated_word ?? w?.word ?? '').trim())
  if (list.length === 0) {
    const text = fallbackText.trim()
    if (!text) return []
    // Diarization produced nothing but a transcript exists — keep the words
    // rather than dropping the meeting on the floor.
    return [{
      id: randomUUID(), meetingId, speakerLabel: 'Speaker 1',
      startTime: 0, endTime: 0, text,
    }]
  }

  const segments: TranscriptSegment[] = []
  let current: { speaker: string; start: number; end: number; words: string[] } | null = null

  for (const w of list) {
    const speaker = normalizeSpeaker(w.speaker)
    const text = String(w.punctuated_word ?? w.word).trim()
    const start = Number(w.start) || 0
    const end = Number(w.end) || 0
    if (current && current.speaker === speaker) {
      current.words.push(text)
      current.end = end
    } else {
      if (current) {
        segments.push({
          id: randomUUID(), meetingId, speakerLabel: current.speaker,
          startTime: current.start, endTime: current.end, text: current.words.join(' '),
        })
      }
      current = { speaker, start, end, words: [text] }
    }
  }
  if (current) {
    segments.push({
      id: randomUUID(), meetingId, speakerLabel: current.speaker,
      startTime: current.start, endTime: current.end, text: current.words.join(' '),
    })
  }
  return segments
}

// Builds the query string. Exported so the billing- and privacy-critical flags
// can be asserted without a network call.
export function buildQuery(opts: DeepgramOptions = {}): string {
  const params = new URLSearchParams({
    model: MODEL,
    diarize: 'true',
    smart_format: 'true',
    punctuate: 'true',
    // Excludes this request from Deepgram's Model Improvement Program. Their
    // partner terms say they do not train on customer data by default; sending
    // this makes that true by construction rather than by trust, and opted-out
    // request data "is retained only for the duration necessary to process the
    // request".
    mip_opt_out: 'true',
  })
  // keyterm is repeated per term — NOT comma/semicolon separated, and it takes
  // no weight/intensifier suffix (that syntax belongs to the legacy `keywords`).
  for (const term of (opts.vocabulary ?? [])
    .map(t => String(t).trim())
    .filter(t => t.length > 0 && t.length <= MAX_KEYTERM_LEN)
    .slice(0, MAX_KEYTERMS)) {
    params.append('keyterm', term)
  }
  return params.toString()
}

export interface DeepgramOptions {
  // Domain terms to bias recognition toward (names, jargon, product nouns).
  vocabulary?: string[]
  onProgress?: (phase: string) => void
}

export async function transcribeAudioDeepgram(
  audioPath: string,
  meetingId: string,
  apiKey: string,
  opts: DeepgramOptions = {},
  signal?: AbortSignal,
): Promise<TranscriptSegment[]> {
  signal?.throwIfAborted()

  opts.onProgress?.('Reading audio…')
  const { size } = await fs.stat(audioPath)
  signal?.throwIfAborted()

  opts.onProgress?.('Transcribing and identifying speakers…')
  const text = await postAudio(audioPath, size, buildQuery(opts), apiKey, signal)

  const body = JSON.parse(text) as {
    results?: { channels?: Array<{ alternatives?: Array<{ transcript?: string; words?: DeepgramWord[] }> }> }
  }
  const alt = body.results?.channels?.[0]?.alternatives?.[0]
  return groupWordsBySpeaker(alt?.words, meetingId, alt?.transcript ?? '')
}

// Uploads over node:https rather than fetch, for two reasons that both bite on
// exactly the long recordings this app exists to handle.
//
// 1. fetch/undici applies a 300-second headersTimeout that cannot be raised
//    without passing an undici Agent as `dispatcher` — and undici is not a
//    dependency we can rely on surviving electron-builder's prune (the same trap
//    that removed dotenv; see env.ts). Deepgram holds the connection open while
//    it works, so a long enough file trips that ceiling and the socket closes
//    with the whole body uploaded and zero bytes read back. Measured on a 77
//    minute file: fetch died that way, node:https with setTimeout(0) returned in
//    39 seconds.
// 2. It streams from disk. The previous code read the entire file into a Buffer
//    and then copied it again into a Uint8Array — about 230 MB of resident memory
//    per hour of 16 kHz mono audio, for a body that is written straight to a
//    socket. The old `ponytail:` note here asked for exactly this.
function postAudio(
  audioPath: string,
  size: number,
  query: string,
  apiKey: string,
  signal?: AbortSignal,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const req = https.request({
      hostname: 'api.deepgram.com',
      path: `/v1/listen?${query}`,
      method: 'POST',
      headers: {
        Authorization: `Token ${apiKey}`,
        'Content-Type': 'audio/wav',
        'Content-Length': size,
      },
    }, res => {
      const chunks: Buffer[] = []
      res.on('data', (c: Buffer) => chunks.push(c))
      res.on('error', reject)
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8')
        if (res.statusCode !== 200) {
          // Surface Deepgram's own message — its 400s name the offending
          // parameter, which is the difference between a two-minute fix and an
          // afternoon.
          reject(new Error(`Deepgram transcription failed (HTTP ${res.statusCode}): ${text.slice(0, 500)}`))
          return
        }
        resolve(text)
      })
    })

    // No client-side inactivity timeout: waiting IS the normal case here.
    req.setTimeout(0)
    req.on('error', reject)

    const onAbort = () => req.destroy(new Error('Transcription aborted'))
    if (signal) {
      if (signal.aborted) { req.destroy(); reject(signal.reason); return }
      signal.addEventListener('abort', onAbort, { once: true })
      req.on('close', () => signal.removeEventListener('abort', onAbort))
    }

    const upload = createReadStream(audioPath)
    upload.on('error', reject)
    upload.pipe(req)
  })
}
