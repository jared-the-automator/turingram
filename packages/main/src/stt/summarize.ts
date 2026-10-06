import type { ActionItem, TranscriptSegment } from '@turingyde/transcript-core'

// Summaries run on Gemini Flash. The key MUST be on a paid/billed project:
// Google's terms for the unpaid tier permit human reviewers to read API input
// and output, use it to train their models, and say outright "do not submit
// sensitive, confidential, or personal information to the Unpaid Services".
// A meeting transcript is confidential by definition. Cost is negligible either
// way — roughly $0.0016 per meeting-hour against $0.26/hr for transcription.
const MODEL = 'gemini-3-flash-preview'

// Measured 2026-07-24: thinking dominates latency here. On a trivial prompt,
// default config spent 347 thinking tokens and 18.9s versus 9.5s with the budget
// at zero, and it scales with transcript length — a 20-second recording took
// 193s to summarize. Summarizing a transcript is not a reasoning-heavy task, and
// summaries landing promptly after a meeting is the whole point, so this trades
// thinking for latency deliberately. Raise it if action-item extraction degrades.
const THINKING_BUDGET = 0

export interface MeetingSummary {
  summary: string
  actionItems: ActionItem[]
  // A short descriptive meeting name ('' when the model can't produce one).
  title: string
  // Diarized label → real name, only where the transcript itself names the
  // speaker (introductions, greetings, being addressed). Empty when unknown.
  speakerNames: Record<string, string>
}

// Gemini responseSchema dialect: `nullable` (not `type: [.., 'null']`),
// propertyOrdering to keep field order stable.
const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    summary: {
      type: 'string',
      description: 'Markdown summary. Lead with what was decided or concluded.',
    },
    action_items: {
      type: 'array',
      description: 'Concrete commitments made in the meeting. Empty if none.',
      items: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'The commitment, phrased as a task.' },
          owner: { type: 'string', nullable: true, description: 'Speaker who owns it, or null.' },
          deadline: { type: 'string', nullable: true, description: 'Stated deadline verbatim, or null.' },
        },
        required: ['text'],
        propertyOrdering: ['text', 'owner', 'deadline'],
      },
    },
    title: {
      type: 'string',
      description: 'A short meeting name (3-7 words) stating what the meeting was about. No date, no word "meeting" unless unavoidable.',
    },
    speakers: {
      type: 'array',
      description: 'Speaker labels whose real name the transcript itself establishes. Empty if none.',
      items: {
        type: 'object',
        properties: {
          label: { type: 'string', description: 'The speaker label exactly as it appears in the transcript, e.g. "Speaker 1".' },
          name: { type: 'string', description: 'The real name the transcript establishes for that label.' },
        },
        required: ['label', 'name'],
        propertyOrdering: ['label', 'name'],
      },
    },
  },
  required: ['summary', 'action_items', 'title', 'speakers'],
  propertyOrdering: ['summary', 'action_items', 'title', 'speakers'],
}

const SYSTEM = `You summarize meeting transcripts. The transcript is machine-generated and will contain transcription errors; read through them rather than quoting them literally.

Rules:
- Lead with outcomes and decisions, not a chronological retelling.
- Only state things actually said. Never infer a decision that was not reached, and never invent an owner or deadline that was not stated.
- If the user took their own notes during the meeting, treat them as the spine of the summary: they signal what mattered to them. Expand and organize around them rather than summarizing independently of them.
- If the meeting reached no conclusion, say so plainly instead of manufacturing one.
- Write plainly. No preamble, no "in this meeting" framing.
- Title: name the meeting by its subject matter the way a person would in a calendar ("Q3 pricing review", "CRM sync debugging session"), not generically.
- Speakers: map a label to a real name only when the transcript itself establishes it — a speaker introduces themselves, addresses another by name and that speaker responds, or is greeted by name when they join. Never guess from context weaker than that; when in doubt, leave the label out.`

// A 1-hour meeting is ~13k tokens of transcript, well inside Flash's window, so
// the whole thing is sent rather than chunked.
export function buildTranscriptText(segments: TranscriptSegment[]): string {
  return segments.map(s => `${s.speakerLabel}: ${s.text}`).join('\n').trim()
}

export function buildPrompt(segments: TranscriptSegment[], notes: string): string {
  const transcript = buildTranscriptText(segments)
  const trimmedNotes = (notes ?? '').trim()
  const notesBlock = trimmedNotes
    ? `The user's own notes, typed during the meeting:\n<notes>\n${trimmedNotes}\n</notes>\n\n`
    : ''
  return `${notesBlock}Transcript:\n<transcript>\n${transcript}\n</transcript>`
}

// Normalizes the model's structured output into our ActionItem shape. Exported
// because this is the boundary where a malformed response would otherwise reach
// the database.
export function parseSummaryResponse(raw: unknown): MeetingSummary {
  const obj = (raw ?? {}) as Record<string, unknown>
  const summary = typeof obj.summary === 'string' ? obj.summary.trim() : ''
  const rawItems = Array.isArray(obj.action_items) ? obj.action_items : []
  const actionItems: ActionItem[] = rawItems
    .map(i => (i ?? {}) as Record<string, unknown>)
    .filter(i => typeof i.text === 'string' && i.text.trim().length > 0)
    .map(i => ({
      text: String(i.text).trim(),
      owner: typeof i.owner === 'string' && i.owner.trim() ? String(i.owner).trim() : null,
      deadline: typeof i.deadline === 'string' && i.deadline.trim() ? String(i.deadline).trim() : null,
    }))
  // Titles land in filenames and window chrome — cap runaway model output.
  const title = typeof obj.title === 'string' ? obj.title.trim().slice(0, 120) : ''
  const speakerNames: Record<string, string> = {}
  const rawSpeakers = Array.isArray(obj.speakers) ? obj.speakers : []
  for (const entry of rawSpeakers.map(s => (s ?? {}) as Record<string, unknown>)) {
    const label = typeof entry.label === 'string' ? entry.label.trim() : ''
    const name = typeof entry.name === 'string' ? entry.name.trim().slice(0, 80) : ''
    if (label && name && name !== label) speakerNames[label] = name
  }
  return { summary, actionItems, title, speakerNames }
}

export async function summarizeMeeting(
  segments: TranscriptSegment[],
  notes: string,
  apiKey: string,
  signal?: AbortSignal,
): Promise<MeetingSummary> {
  if (segments.length === 0) return { summary: '', actionItems: [], title: '', speakerNames: {} }
  signal?.throwIfAborted()

  // @google/genai is ESM-only; a real runtime import() loads it under CommonJS
  // (same shim gemini.ts uses).
  const { GoogleGenAI } = await (new Function('m', 'return import(m)'))('@google/genai') as typeof import('@google/genai')
  const ai = new GoogleGenAI({ apiKey })

  const response = await ai.models.generateContent({
    model: MODEL,
    contents: [{ role: 'user', parts: [{ text: buildPrompt(segments, notes) }] }],
    config: {
      systemInstruction: SYSTEM,
      responseMimeType: 'application/json',
      responseSchema: RESPONSE_SCHEMA,
      thinkingConfig: { thinkingBudget: THINKING_BUDGET },
      abortSignal: signal,
    },
  })

  const text = response.text ?? ''
  if (!text.trim()) return { summary: '', actionItems: [], title: '', speakerNames: {} }
  try {
    return parseSummaryResponse(JSON.parse(text))
  } catch {
    // responseSchema should guarantee valid JSON; if it somehow isn't, keep the
    // prose rather than losing the whole summary.
    return { summary: text.trim(), actionItems: [], title: '', speakerNames: {} }
  }
}
