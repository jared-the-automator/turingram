import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('api', {
  startRecording: () => ipcRenderer.invoke('recording:start'),
  stopRecording: (notes: string, participants = '') => ipcRenderer.invoke('recording:stop', notes, participants),
  cancelProcessing: () => ipcRenderer.invoke('recording:cancel-processing'),
  retryTranscription: (id: string) => ipcRenderer.invoke('meetings:retry', id),
  hasAudio: (id: string) => ipcRenderer.invoke('meetings:has-audio', id),
  getRecordingState: () => ipcRenderer.invoke('recording:state'),

  listMeetings: () => ipcRenderer.invoke('meetings:list'),
  getMeeting: (id: string) => ipcRenderer.invoke('meetings:get', id),
  getSegments: (id: string) => ipcRenderer.invoke('meetings:segments', id),
  searchMeetings: (query: string) => ipcRenderer.invoke('meetings:search', query),
  renameMeeting: (id: string, title: string) => ipcRenderer.invoke('meetings:rename', id, title),
  deleteMeeting: (id: string) => ipcRenderer.invoke('meetings:delete', id),
  updateNotes: (id: string, notes: string) => ipcRenderer.invoke('meetings:update-notes', id, notes),
  assignSpeakers: (meetingId: string, map: Record<string, string>) =>
    ipcRenderer.invoke('meetings:assign-speakers', meetingId, map),
  exportMeeting: (id: string, format?: string) => ipcRenderer.invoke('meetings:export', id, format ?? 'md'),
  revealFile: (filePath: string) => ipcRenderer.invoke('shell:reveal', filePath),

  getAgentInfo: () => ipcRenderer.invoke('agent:info'),
  chooseTranscriptsDir: () => ipcRenderer.invoke('agent:choose-dir'),
  resetTranscriptsDir: () => ipcRenderer.invoke('agent:reset-dir'),

  getSettings: () => ipcRenderer.invoke('settings:get'),
  updateSettings: (patch: object) => ipcRenderer.invoke('settings:update', patch),
  getAudioDevices: () => ipcRenderer.invoke('audio:devices'),

  getKeyStatus: () => ipcRenderer.invoke('keys:status'),
  reloadKeys: () => ipcRenderer.invoke('keys:reload'),
  saveKeys: (updates: Record<string, string>) => ipcRenderer.invoke('keys:save', updates),
  revealEnvFile: () => ipcRenderer.invoke('keys:reveal-env'),

  getDrinkState: () => ipcRenderer.invoke('drinks:state'),
  redeemDrink: (token: string) => ipcRenderer.invoke('drinks:redeem', token),
  onDrinkNag: (cb: (line: string) => void) => {
    const handler = (_: unknown, line: string) => cb(line);
    ipcRenderer.on('drinks:nag', handler);
    return () => ipcRenderer.off('drinks:nag', handler);
  },

  onProcessingProgress: (cb: (data: { phase: string; meetingId?: string; error?: string }) => void) => {
    const handler = (_: unknown, data: { phase: string; meetingId?: string; error?: string }) => cb(data);
    ipcRenderer.on('processing:progress', handler);
    return () => ipcRenderer.off('processing:progress', handler);
  },

  onRecordingAutostopped: (cb: () => void) => {
    ipcRenderer.on('recording:autostopped', cb);
    return () => ipcRenderer.off('recording:autostopped', cb);
  },

  onRecordingError: (cb: (message: string) => void) => {
    const handler = (_: unknown, message: string) => cb(message);
    ipcRenderer.on('recording:error', handler);
    return () => ipcRenderer.off('recording:error', handler);
  },

  // Distinct from onRecordingError, which reports a problem the recording
  // survived. This one means the recording is over and there is no audio.
  onRecordingFailed: (cb: (message: string) => void) => {
    const handler = (_: unknown, message: string) => cb(message);
    ipcRenderer.on('recording:failed', handler);
    return () => ipcRenderer.off('recording:failed', handler);
  },

  onMeetingDetected: (cb: (c: { app: string; title: string }) => void) => {
    const handler = (_: unknown, c: { app: string; title: string }) => cb(c);
    ipcRenderer.on('meeting:detected', handler);
    return () => ipcRenderer.off('meeting:detected', handler);
  },
});
