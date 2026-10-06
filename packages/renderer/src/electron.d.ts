import type { AppSettings, Meeting, TranscriptSegment, AudioDevice, AgentInfo, KeyStatus, DrinkState } from '@turingyde/transcript-core';

interface ProcessingProgress { phase: string; meetingId?: string; error?: string }

// null from chooseTranscriptsDir means the user cancelled the picker.
interface DirChangeResult { ok: boolean; info?: AgentInfo; error?: string }

interface SearchResult {
  segmentId: string; meetingId: string; meetingTitle: string;
  meetingStartedAt: number; text: string; snippet: string;
}

declare global {
  interface Window {
    api: {
      startRecording(): Promise<string>
      stopRecording(notes: string, participants?: string): Promise<Meeting | null>
      cancelProcessing(): Promise<void>
      retryTranscription(id: string): Promise<Meeting | null>
      hasAudio(id: string): Promise<boolean>
      getRecordingState(): Promise<{ isRecording: boolean; meetingId: string | null; startedAt: number | null }>
      listMeetings(): Promise<Meeting[]>
      getMeeting(id: string): Promise<Meeting | null>
      getSegments(id: string): Promise<TranscriptSegment[]>
      searchMeetings(query: string): Promise<SearchResult[]>
      renameMeeting(id: string, title: string): Promise<void>
      deleteMeeting(id: string): Promise<void>
      updateNotes(id: string, notes: string): Promise<void>
      assignSpeakers(meetingId: string, map: Record<string, string>): Promise<void>
      exportMeeting(id: string, format?: 'md' | 'txt' | 'json' | 'srt'): Promise<string>
      revealFile(filePath: string): Promise<void>
      getAgentInfo(): Promise<AgentInfo>
      chooseTranscriptsDir(): Promise<DirChangeResult | null>
      resetTranscriptsDir(): Promise<DirChangeResult>
      getSettings(): Promise<AppSettings>
      updateSettings(patch: Partial<AppSettings>): Promise<void>
      getAudioDevices(): Promise<AudioDevice[]>
      getKeyStatus(): Promise<KeyStatus>
      reloadKeys(): Promise<KeyStatus>
      saveKeys(updates: Record<string, string>): Promise<KeyStatus>
      revealEnvFile(): Promise<void>
      getDrinkState(): Promise<DrinkState>
      redeemDrink(token: string): Promise<boolean>
      onDrinkNag(cb: (line: string) => void): () => void
      onProcessingProgress(cb: (data: ProcessingProgress) => void): () => void
      onRecordingAutostopped(cb: () => void): () => void
      reportBug(problem?: string): Promise<void>
      onRecordingError(cb: (message: string) => void): () => void
      onRecordingFailed(cb: (message: string) => void): () => void
      onMeetingDetected(cb: (c: { app: string; title: string }) => void): () => void
    }
  }
}
