// packages/transcript-core/src/index.ts

export interface WordToken {
  word: string
  startTime: number
  endTime: number
  probability: number
}

export interface TranscriptSegment {
  id: string
  meetingId: string
  speakerLabel: string
  startTime: number
  endTime: number
  text: string
  wordTimestamps?: WordToken[]
}

export interface ActionItem {
  text: string
  owner: string | null
  deadline: string | null
}

export interface Meeting {
  id: string
  title: string
  startedAt: number
  endedAt: number
  durationSec: number
  notes: string
  summary: string | null
  actionItems: ActionItem[]
}

// The file an external agent actually reads. It carries the derived content
// too, not just the raw transcript: an agent that has to re-read 4000 segments
// to learn what the meeting was about is paying for work already done here.
// Times stay numeric seconds — formatted clock strings are for humans.
export interface AgentHook {
  id: string
  title: string
  startedAt: number
  endedAt: number
  durationSec: number
  notes: string
  summary: string | null
  actionItems: ActionItem[]
  segments: Array<{
    speaker: string
    startTime: number
    endTime: number
    text: string
  }>
}

// Where an external agent should be pointed.
export interface AgentInfo {
  dir: string
  indexPath: string
  readmePath: string
  isDefault: boolean
  fileCount: number
}

// Which provider credentials resolve, by name. Never a value: the main process
// has no handler that returns one, so a compromised renderer has nothing to read
// back.
export interface KeyStatus {
  present: Record<'DEEPGRAM_API_KEY' | 'GEMINI_API_KEY', boolean>
  envPath: string
}

export type DrinkTierId = 'coffee' | 'beer' | 'wine' | 'cocktail' | 'champagne'

// What the renderer sees of the drinks ledger. The install id and the token
// stay in the main process; each tier's url already carries the install.
export interface DrinkState {
  recordedSec: number
  meetings: number
  /** the label of the drink this install bought, or null */
  bought: string | null
  tiers: Array<{ id: DrinkTierId; label: string; amount: number; url: string }>
}

export interface AudioDevice {
  id: string
  name: string
  isDefault: boolean
}

export interface AppSettings {
  // 'local' was removed 2026-07-22 — local inference could not be both fast and
  // accurate on ordinary hardware. Any unrecognized saved value (including
  // 'local') falls back to the default at dispatch.
  //
  // 'deepgram' is the default: Nova-3 pre-recorded at $0.26/hr with diarization
  // included, and contractual no-training-by-default. AssemblyAI was removed
  // 2026-07-24 — its ToS §4.3 licenses training on customer audio. 'gemini-free'
  // sends audio to a tier whose terms permit human review and model training; it
  // exists for dev testing only and must never see a real meeting.
  transcriptionEngine: 'deepgram' | 'gemini-free' | 'gemini-paid'
  // UI theme. 'dark' is the original synthwave look; 'light' is a standard
  // corporate white/blue palette. Default dark.
  theme: 'dark' | 'light'
  audioDeviceId: string | null
  keepRecordings: boolean
  // NOTE: no API keys here, deliberately. Credentials are provisioned by whoever
  // operates the install — a .env in the app's data dir, read by env.ts — which
  // is the seam a metering proxy or short-lived token occupies in a commercial
  // deployment. The client never collects, stores, or displays a key.
  // Ask for confirmation before deleting meetings. When false, delete is immediate.
  confirmBeforeDelete: boolean
  // Show the "inform the other party" recording-consent reminder before each
  // recording. Dismissing it requires acknowledging responsibility for consent
  // laws, so it starts false (reminder on) and only the user turns it off.
  consentReminderDismissed: boolean
  // Watch for the mic being opened by a conferencing app and offer to record.
  // Prompt-only — it never starts recording on its own. Passive and local, so it
  // defaults on; the toggle exists for anyone who wants no background watcher.
  autoDetectMeetings: boolean
  // Start Turingram with the login session (hidden, in the tray) so detection is
  // already running before a call starts — the point of auto-detect. Defaults
  // off: registering an app to launch at login is a decision the user should
  // make, not one an install makes for them.
  launchAtLogin: boolean
  // Where the machine-readable transcript JSON is written. null means the app's
  // own data directory. Configurable because the point of that folder is being
  // read by someone else's tools, and those tools are already pointed at a
  // directory the user thinks in — a notes vault, a project folder. Putting the
  // transcripts there is what makes "look in the vault" work with no setup.
  transcriptsDir: string | null
  vocabulary: string[]
}

export const DEFAULT_SETTINGS: AppSettings = {
  transcriptionEngine: 'deepgram',
  theme: 'dark',
  audioDeviceId: null,
  keepRecordings: false,
  confirmBeforeDelete: true,
  consentReminderDismissed: false,
  autoDetectMeetings: true,
  launchAtLogin: false,
  transcriptsDir: null,
  vocabulary: [
    'Turingram', 'HubSpot', 'Salesforce', 'Zoom', 'Slack',
    'Google Meet', 'Microsoft Teams', 'Claude', 'ChatGPT',
    'Anthropic', 'OpenAI',
  ],
}
