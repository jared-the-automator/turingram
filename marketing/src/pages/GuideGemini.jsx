import PromptBlock from '../components/PromptBlock.jsx'
import {
  GuideNav,
  GuideFooterCTA,
  Step,
  SectionHeading,
  SectionSubhead,
  Callout,
  TOC,
} from '../components/GuideLayout.jsx'

const TOC_ITEMS = [
  { id: 'what-you-get', label: 'What you get' },
  { id: 'prerequisites', label: 'Prerequisites' },
  { id: 'record-export', label: 'Record and export' },
  { id: 'quick-start', label: 'Quick start' },
  { id: 'notebooklm', label: 'NotebookLM (the real feature)' },
  { id: 'summary', label: 'Meeting summary' },
  { id: 'action-items', label: 'Action items' },
  { id: 'followup-email', label: 'Follow-up email' },
  { id: 'workspace', label: 'Google Workspace integration' },
  { id: 'crm', label: 'CRM data extraction' },
]

export default function GuideGemini() {
  return (
    <div className="bg-[#020210] text-white min-h-screen">
      <GuideNav />

      <div className="max-w-7xl mx-auto px-6 md:px-12 py-14">
        <div className="grid grid-cols-1 lg:grid-cols-[200px_1fr] gap-16">

          <TOC items={TOC_ITEMS} />

          <main className="min-w-0 max-w-3xl">
            <p className="text-[12px] text-[#40EFAB] font-mono uppercase tracking-widest mb-4">Guide</p>
            <h1 className="text-3xl md:text-4xl font-bold tracking-tight leading-tight mb-4">
              Meeting notes with Gemini
            </h1>
            <p className="text-[17px] text-white/55 leading-relaxed mb-12">
              Record with Turingram, export the transcript, and use Gemini for the analysis. If your workflow runs on Google, Gemini integrates naturally across Docs, Tasks, and Gmail. The standout feature is NotebookLM — Google's tool for building a searchable archive across all your transcripts.
            </p>

            {/* ── What you get ── */}
            <SectionHeading id="what-you-get">What you get</SectionHeading>
            <SectionSubhead>What Turingram and Gemini can do together.</SectionSubhead>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-12">
              {[
                ['Meeting summary', 'Gemini chat or Docs'],
                ['Action items with owners', 'Prompt (copy below)'],
                ['Follow-up email draft', 'Prompt (copy below)'],
                ['Searchable history', 'NotebookLM (the best option available)'],
                ['Google Tasks integration', 'Gemini in Google Workspace'],
                ['CRM data extraction', 'Structured output prompt'],
              ].map(([feature, tool]) => (
                <div key={feature} className="flex items-start gap-3 rounded-lg border border-white/[0.07] bg-[#0d0926] p-3.5">
                  <span className="text-[#40EFAB] mt-0.5">+</span>
                  <div>
                    <span className="text-[13px] font-semibold text-white block">{feature}</span>
                    <span className="text-[12px] text-white/60">{tool}</span>
                  </div>
                </div>
              ))}
            </div>

            {/* ── Prerequisites ── */}
            <SectionHeading id="prerequisites">Prerequisites</SectionHeading>
            <SectionSubhead>A Google account covers most of this.</SectionSubhead>

            <div className="space-y-3 mb-12">
              <div className="rounded-lg border border-white/[0.07] bg-[#0d0926] p-4">
                <p className="text-[14px] font-semibold mb-1">Turingram</p>
                <p className="text-[13px] text-white/65">Install and record at least one meeting. You need a real transcript to test the NotebookLM setup.</p>
              </div>
              <div className="rounded-lg border border-white/[0.07] bg-[#0d0926] p-4">
                <p className="text-[14px] font-semibold mb-1">Google account</p>
                <p className="text-[13px] text-white/65">Free. Gemini.google.com and NotebookLM (notebooklm.google.com) are both available without a paid subscription. Google One AI Premium gives you longer context and Workspace integration, but the core workflow works without it.</p>
              </div>
            </div>

            {/* ── Record and export ── */}
            <SectionHeading id="record-export">Record your meeting and export the transcript</SectionHeading>
            <SectionSubhead>Same process before every meeting.</SectionSubhead>

            <div className="divide-y divide-white/[0.06]">
              <Step n="1" title="Start recording before the call">
                <p>Open Turingram and click record. It captures your mic and system audio on separate channels and runs in the background during the call.</p>
              </Step>
              <Step n="2" title="Stop and wait for transcription">
                <p>Click stop when the call ends. Deepgram transcribes the recording and returns it split by speaker. Assign speaker names when it finishes.</p>
              </Step>
              <Step n="3" title="Export as plain text or Markdown">
                <p>For Gemini chat, plain text pastes more cleanly than Markdown. For NotebookLM, either format works, Markdown is preferable because the speaker labels and timestamps survive formatting.</p>
                <Callout>
                  Save exports to a folder with consistent naming like <code className="text-[#40EFAB] text-[12px]">2026-05-31-client-name.md</code>. You'll be uploading multiple files to NotebookLM and clear names help.
                </Callout>
              </Step>
            </div>

            {/* ── Quick start ── */}
            <SectionHeading id="quick-start">Quick start: one meeting, no setup</SectionHeading>
            <SectionSubhead>Test it right now before doing anything else.</SectionSubhead>

            <p className="text-[15px] text-white/55 leading-relaxed mb-6">
              Go to gemini.google.com. Start a new conversation. Paste your transcript and run this:
            </p>

            <PromptBlock
              label="one-shot meeting analysis"
              code={`Here's a meeting transcript. Give me:

1. What was decided (bullet list)
2. Action items with owners, only explicit commitments, not inferred
3. A short follow-up email to the attendees

[paste transcript here]`}
            />

            <p className="text-[15px] text-white/55 leading-relaxed mt-6">
              If that handles what you need, you're done. The rest of this guide sets up persistent history and Workspace integration.
            </p>

            {/* ── NotebookLM ── */}
            <SectionHeading id="notebooklm">NotebookLM: searchable meeting history</SectionHeading>
            <SectionSubhead>Build a searchable archive of every meeting you record.</SectionSubhead>

            <p className="text-[15px] text-white/55 leading-relaxed mb-6">
              NotebookLM (notebooklm.google.com) lets you create a "notebook" with uploaded sources: documents, PDFs, text files. Once your transcripts are in there, you can ask questions across all of them at once. It reasons across the full content, not just keyword matches.
            </p>

            <div className="divide-y divide-white/[0.06] mb-8">
              <Step n="1" title="Go to NotebookLM">
                <p>Open notebooklm.google.com and sign in with your Google account. It's free.</p>
              </Step>
              <Step n="2" title="Create a notebook">
                <p>Click "New notebook." Name it something like "Client: Acme" or "Weekly team standups" or "Sales calls Q2." One notebook per recurring meeting type works better than one giant archive.</p>
              </Step>
              <Step n="3" title="Add your first source">
                <p>Click "Add source" in the Sources panel on the left. Choose "Upload file" and upload your transcript export (txt or md). NotebookLM processes it and adds it to the notebook.</p>
                <p>Repeat this after every meeting: open the relevant notebook, upload the new transcript. 30 seconds.</p>
              </Step>
              <Step n="4" title="Query across all your transcripts">
                <p>In the chat on the right side of the notebook, ask questions. NotebookLM searches all your uploaded sources and cites the specific source for each answer:</p>
                <PromptBlock
                  label="cross-meeting queries"
                  code={`What commitments have I made that don't have a follow-up yet?

What was the last thing we decided about the contract renewal?

What did [client name] say their budget constraints were?

Which meetings mentioned the Q3 launch?

List every deadline mentioned across all my meetings this month.`}
                />
              </Step>
              <Step n="5" title="Use the Audio Overview for dense transcripts">
                <p>NotebookLM has an "Audio Overview" feature that generates a podcast-style summary of your sources. If you have back-to-back calls and need a fast brief on what was covered, this cuts the review time significantly.</p>
                <p>Click "Generate" next to Audio Overview in the notebook to try it.</p>
              </Step>
            </div>

            <Callout>
              NotebookLM also accepts Google Docs, PDFs, and YouTube URLs as sources. If you keep client notes in Docs, you can add those alongside your transcripts and query across everything at once.
            </Callout>

            {/* ── Summary ── */}
            <SectionHeading id="summary">Meeting summary</SectionHeading>
            <SectionSubhead>Standalone prompt for when you just need the notes quickly.</SectionSubhead>

            <PromptBlock
              label="meeting summary"
              code={`Summarize this meeting. What was decided, what's still open, and what happens next. Bullet points, under 150 words.

[paste transcript]`}
            />

            {/* ── Action items ── */}
            <SectionHeading id="action-items">Action items</SectionHeading>
            <SectionSubhead>Pull explicit commitments from any meeting.</SectionSubhead>

            <PromptBlock
              label="action items: explicit only"
              code={`Extract action items from this transcript. Include only commitments someone explicitly stated. Don't infer from context.

Format: [Owner name]: [task], [deadline if mentioned]

[paste transcript]`}
            />

            {/* ── Follow-up email ── */}
            <SectionHeading id="followup-email">Follow-up email</SectionHeading>
            <SectionSubhead>Useful starting point, usually needs a light edit before sending.</SectionSubhead>

            <PromptBlock
              label="follow-up email"
              code={`Write a follow-up email to the meeting attendees. Keep it short: what we decided, who's doing what, next step. Write it like a human sent it, not a tool.

[paste transcript]`}
            />

            {/* ── Workspace ── */}
            <SectionHeading id="workspace">Google Workspace integration</SectionHeading>
            <SectionSubhead>If your work already lives in Google, this is the natural extension.</SectionSubhead>

            <p className="text-[15px] text-white/55 leading-relaxed mb-6">
              Gemini integrates with Google Docs, Gmail, and Tasks through Google Workspace. The workflow here depends on your Google plan, the free tier gets Gemini in Docs; the paid Workspace tiers get deeper integration including Gmail drafting and cross-app awareness.
            </p>

            <div className="divide-y divide-white/[0.06] mb-8">
              <Step n="1" title="Meeting notes in Google Docs">
                <p>Create a new Google Doc for the meeting. Open the Gemini panel (the star icon in the right sidebar or via "Help me write" prompts). Paste your transcript into the document body, then use the Gemini panel to process it:</p>
                <PromptBlock
                  label="Gemini in Docs"
                  code={`Summarize this transcript into a meeting notes document. Include: key decisions, action items with owners, and any open questions. Format it clearly so it's easy to share.`}
                />
                <p>The output drops directly into the document, which you can then share with attendees from Docs.</p>
              </Step>
              <Step n="2" title="Task extraction to Google Tasks">
                <p>In Gemini chat (gemini.google.com), paste the transcript and ask:</p>
                <PromptBlock
                  label="task extraction for Google Tasks"
                  code={`From this transcript, extract action items I should add to Google Tasks. For each task:
- Task name (concise)
- Assignee if not me
- Due date if mentioned

Return as a plain list I can copy.

[paste transcript]`}
                />
                <p>Then add the tasks manually to Google Tasks, or use a Zapier/Make workflow to add them automatically from the JSON output prompt in the CRM section below.</p>
              </Step>
              <Step n="3" title="Gmail draft for follow-up">
                <p>In Gmail, click Compose and look for the "Help me write" button (pencil icon at the bottom of the compose window). Paste your transcript and prompt:</p>
                <PromptBlock
                  label="Gmail: Help me write"
                  code={`Write a follow-up email based on this meeting transcript. Confirm decisions, list action items with owners, and mention the next step. Short and direct.

[paste transcript]`}
                />
                <p>Gmail generates a draft you can edit and send directly. This only works in Gmail with a Google Workspace account that has Gemini for Workspace enabled.</p>
              </Step>
            </div>

            {/* ── CRM ── */}
            <SectionHeading id="crm">CRM data extraction</SectionHeading>
            <SectionSubhead>Structured output you can import or automate.</SectionSubhead>

            <PromptBlock
              label="CRM data: JSON output"
              code={`Extract CRM data from this transcript. Return as JSON:

{
  "contacts": [],
  "company": "",
  "my_commitments": [{ "task": "", "deadline": "" }],
  "their_commitments": [{ "name": "", "task": "" }],
  "pain_points": [],
  "budget_signals": [],
  "next_touchpoint": "",
  "meeting_outcome": "positive | neutral | negative"
}

Literal only. Leave fields empty if not mentioned.

[paste transcript]`}
            />

            <GuideFooterCTA />
          </main>
        </div>
      </div>
    </div>
  )
}
