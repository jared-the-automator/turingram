import { describe, it, expect } from 'vitest'
import { parseGeminiSegments } from '../stt/gemini'

describe('parseGeminiSegments', () => {
  it('parses a well-formed JSON segment array', () => {
    const raw = JSON.stringify([
      { speaker: 'Speaker 1', startTime: 0,   endTime: 5.2,  text: 'Hello world' },
      { speaker: 'Speaker 2', startTime: 5.5, endTime: 10.1, text: 'Hi there' },
    ])
    const result = parseGeminiSegments(raw, 'meet-1')
    expect(result).toHaveLength(2)
    expect(result[0].speakerLabel).toBe('Speaker 1')
    expect(result[0].text).toBe('Hello world')
    expect(result[0].startTime).toBe(0)
    expect(result[0].endTime).toBe(5.2)
    expect(result[0].meetingId).toBe('meet-1')
    expect(typeof result[0].id).toBe('string')
  })

  it('strips markdown fences before parsing', () => {
    const raw = '```json\n[{"speaker":"Speaker 1","startTime":0,"endTime":3,"text":"Hi"}]\n```'
    const result = parseGeminiSegments(raw, 'meet-2')
    expect(result).toHaveLength(1)
    expect(result[0].text).toBe('Hi')
  })

  it('falls back to a single segment when JSON is malformed', () => {
    const raw = 'Just some plain text response.'
    const result = parseGeminiSegments(raw, 'meet-3')
    expect(result).toHaveLength(1)
    expect(result[0].speakerLabel).toBe('Speaker 1')
    expect(result[0].text).toBe('Just some plain text response.')
    expect(result[0].meetingId).toBe('meet-3')
  })

  it('returns empty array for empty string', () => {
    expect(parseGeminiSegments('', 'meet-4')).toHaveLength(0)
  })
})
