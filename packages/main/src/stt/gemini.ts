import { randomUUID } from 'crypto'
import type { TranscriptSegment } from '@turingyde/transcript-core'

const TRANSCRIPTION_PROMPT = `Transcribe this audio recording of a meeting. Return a JSON array where each element is a speaker turn. Each element must have:
- speaker: "Speaker 1", "Speaker 2", etc. Use "Speaker 1" if only one speaker is present.
- startTime: start time in seconds as a number
- endTime: end time in seconds as a number
- text: the spoken words for this turn

Group consecutive speech from the same speaker into one segment. Return ONLY the JSON array with no markdown fences or other text.`

interface GeminiSegment {
  speaker: string
  startTime: number
  endTime: number
  text: string
}

export function parseGeminiSegments(raw: string, meetingId: string): TranscriptSegment[] {
  if (!raw.trim()) return []

  let segments: GeminiSegment[]
  try {
    const cleaned = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim()
    const parsed = JSON.parse(cleaned)
    if (!Array.isArray(parsed)) throw new Error('not an array')
    segments = parsed
  } catch {
    return [{
      id: randomUUID(),
      meetingId,
      speakerLabel: 'Speaker 1',
      startTime: 0,
      endTime: 0,
      text: raw.trim(),
    }]
  }

  return segments.map(seg => ({
    id: randomUUID(),
    meetingId,
    speakerLabel: String(seg.speaker ?? 'Speaker 1'),
    startTime: Number(seg.startTime) || 0,
    endTime: Number(seg.endTime) || 0,
    text: String(seg.text ?? ''),
  }))
}

export async function transcribeAudioGemini(
  audioPath: string,
  meetingId: string,
  apiKey: string,
  signal?: AbortSignal,
): Promise<TranscriptSegment[]> {
  // @google/genai is ESM-only; TypeScript compiles import() to require() under CommonJS,
  // so we use new Function to get a real runtime import() that can load ESM modules.
  const { GoogleGenAI, FileState } = await (new Function('m', 'return import(m)'))('@google/genai') as typeof import('@google/genai')
  const ai = new GoogleGenAI({ apiKey })

  const uploaded = await ai.files.upload({
    file: audioPath,
    config: { mimeType: 'audio/wav' },
  })

  if (!uploaded.name) throw new Error('Gemini Files API returned an upload with no name')

  let fileInfo = uploaded
  try {
    // Server-side processing budget: long recordings take longer than the old
    // 60 s cap (30 × 2 s), which failed every sizeable meeting upload.
    const deadline = Date.now() + 10 * 60 * 1000
    while (fileInfo.state === FileState.PROCESSING && Date.now() < deadline) {
      signal?.throwIfAborted()
      await new Promise(r => setTimeout(r, 2000))
      fileInfo = await ai.files.get({ name: fileInfo.name! })
    }

    if (fileInfo.state === FileState.ACTIVE && !fileInfo.uri) throw new Error('Gemini Files API returned an active file with no URI')

    if (fileInfo.state !== FileState.ACTIVE) {
      throw new Error(`Gemini file upload ended in state: ${fileInfo.state}`)
    }

    signal?.throwIfAborted()
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: [
        {
          role: 'user',
          parts: [
            { fileData: { mimeType: 'audio/wav', fileUri: fileInfo.uri! } },
            { text: TRANSCRIPTION_PROMPT },
          ],
        },
      ],
      config: {
        // "Stop & discard" must actually stop the request, and a hung request
        // must not leave the UI on "Uploading…" forever.
        abortSignal: signal,
        httpOptions: { timeout: 10 * 60 * 1000 },
      },
    })
    return parseGeminiSegments(response.text ?? '', meetingId)
  } finally {
    await ai.files.delete({ name: fileInfo.name! }).catch(() => {})
  }
}
