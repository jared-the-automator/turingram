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
  { id: 'summary', label: 'Meeting summary' },
  { id: 'action-items', label: 'Action items' },
  { id: 'followup-email', label: 'Follow-up email' },
  { id: 'projects', label: 'Searchable history with Projects' },
  { id: 'crm', label: 'CRM data extraction' },
  { id: 'agenthook', label: 'agentHook for automation' },
]

export default function GuideClaude() {
  return (
    <div className="bg-[#020210] text-white min-h-screen">
      <GuideNav />

      <div className="max-w-7xl mx-auto px-6 md:px-12 py-14">
        <div className="grid grid-cols-1 lg:grid-cols-[200px_1fr] gap-16">

          <TOC items={TOC_ITEMS} />

          <main className="min-w-0 max-w-3xl">
            <p className="text-[12px] text-[#40EFAB] font-mono uppercase tracking-widest mb-4">Guide</p>
            <h1 className="text-3xl md:text-4xl font-bold tracking-tight leading-tight mb-4">
              Meeting notes with Claude
            </h1>
            <p className="text-[17px] text-white/55 leading-relaxed mb-12">
              Record with Turingram, export the transcript, and use Claude for everything that comes next. This guide covers every common use case: summaries, action items, follow-up emails, searchable history, and CRM extraction.
            </p>

            {/* ── What you get ── */}
            <SectionHeading id="what-you-get">What you get</SectionHeading>
            <SectionSubhead>What Turingram and Claude can do together.</SectionSubhead>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-12">
              {[
                ['Meeting summary', 'Claude Projects'],
                ['Action items with owners', 'Prompt (copy below)'],
                ['Follow-up email draft', 'Prompt (copy below)'],
                ['Searchable history', 'Claude Projects + file indexing'],
                ['CRM data extraction', 'Structured JSON output'],
                ['Automation pipeline', 'agentHook JSON format'],
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
            <SectionSubhead>Two things, both of which you probably already have.</SectionSubhead>

            <div className="space-y-3 mb-12">
              <div className="rounded-lg border border-white/[0.07] bg-[#0d0926] p-4">
                <p className="text-[14px] font-semibold mb-1">Turingram</p>
                <p className="text-[13px] text-white/65">Install and record one meeting before working through this guide. You'll need an actual transcript to paste.</p>
              </div>
              <div className="rounded-lg border border-white/[0.07] bg-[#0d0926] p-4">
                <p className="text-[14px] font-semibold mb-1">Claude.ai account</p>
                <p className="text-[13px] text-white/65">The free tier covers everything in this guide except Projects. Claude Pro ($20/month) unlocks Projects and longer context, worth it if you're doing the history setup in Part 5. That said, even without Pro, everything else works.</p>
              </div>
            </div>

            {/* ── Record and export ── */}
            <SectionHeading id="record-export">Record your meeting and export the transcript</SectionHeading>
            <SectionSubhead>You'll do this before every meeting going forward. Takes about 30 seconds.</SectionSubhead>

            <div className="divide-y divide-white/[0.06]">
              <Step n="1" title="Start recording before the call">
                <p>Open Turingram and click the record button before you join the meeting. It captures your mic and system audio separately, so your voice and the other participants stay on distinct channels.</p>
                <p>You don't need to do anything during the call. Turingram runs in the background.</p>
              </Step>
              <Step n="2" title="Stop when you're done">
                <p>Click stop after the call ends. The recording uploads to Deepgram and comes back with the speakers already split apart. You'll see the transcript appear in the app when it's done.</p>
              </Step>
              <Step n="3" title="Review speaker labels">
                <p>Turingram auto-detects how many speakers were in the meeting. After processing, it asks you to assign names. If it missed a speaker or merged two voices, you can correct it here.</p>
              </Step>
              <Step n="4" title="Export as Markdown">
                <p>Click Export and choose Markdown. This gives you a clean, readable version with timestamps and speaker labels that Claude handles well. For the automation setup in Part 7, use agentHook JSON instead.</p>
                <Callout>
                  Save your exports to a folder like <code className="text-[#40EFAB] text-[12px]">~/meetings/</code> with the meeting date in the filename. When you set up a Claude Project later, you'll upload these files as a batch.
                </Callout>
              </Step>
            </div>

            {/* ── Meeting summary ── */}
            <SectionHeading id="summary">Meeting summary</SectionHeading>
            <SectionSubhead>Format it however your workflow needs.</SectionSubhead>

            <div className="divide-y divide-white/[0.06] mb-8">
              <Step n="1" title="Open claude.ai and start a new chat">
                <p>No setup required for this part. Just open a conversation.</p>
              </Step>
              <Step n="2" title="Paste the transcript and add your prompt">
                <p>Either paste the full Markdown transcript directly, or upload it as a file using the attachment button.</p>
              </Step>
              <Step n="3" title="Run the prompt">
                <PromptBlock
                  label="meeting summary"
                  code={`Summarize this meeting. Give me:

1. What was decided (bullet list, one line each)
2. What's still open or unresolved
3. Action items, each one as: [owner name]: [task] [deadline if mentioned]

Keep it short. Don't pad.

[paste transcript here]`}
                />
              </Step>
            </div>

            <Callout>
              The first time you run this, adjust the prompt format to match how you actually work. If you file notes in Notion, ask for a Notion table. If you use plain-text bullet lists, say so. You're defining the output format once, not permanently, change it whenever a meeting calls for something different.
            </Callout>

            {/* ── Action items ── */}
            <SectionHeading id="action-items">Action items</SectionHeading>
            <SectionSubhead>Pull explicit commitments from any meeting.</SectionSubhead>

            <p className="text-[15px] text-white/55 leading-relaxed mb-6">
              The prompt below only extracts what someone actually said they'd do. Claude won't infer action items from context or add ones that weren't stated. If you want inferred items too, just remove that constraint.
            </p>

            <PromptBlock
              label="action items: explicit only"
              code={`From this transcript, list only the action items where someone explicitly committed to doing something. Don't infer. If no one said they'd do it, don't include it.

Format: [Name]: [What they committed to], by [date] if a date was mentioned.

[paste transcript]`}
            />

            <div className="mt-4">
              <PromptBlock
                label="action items: formatted for Notion / Linear / plain text"
                code={`Extract action items from this transcript and format them as a table:
| Owner | Task | Deadline | Priority |

For priority: use High if the person said it was urgent, Low if deferred, Medium otherwise. Leave Deadline blank if none was mentioned.

[paste transcript]`}
              />
            </div>

            {/* ── Follow-up email ── */}
            <SectionHeading id="followup-email">Follow-up email</SectionHeading>
            <SectionSubhead>Write once, send in 2 minutes instead of 15.</SectionSubhead>

            <PromptBlock
              label="follow-up email draft"
              code={`Write a follow-up email to the meeting attendees. Keep it short.

Structure:
- One sentence on what we discussed
- What we decided (bullet list)
- Who's doing what (pull from action items)
- Next step or next meeting if one was mentioned

Don't be corporate. Write it like a person, not a PR team.

[paste transcript]`}
            />

            <div className="mt-4">
              <PromptBlock
                label="follow-up email: external client version"
                code={`Write a client-facing follow-up email based on this meeting. The client is [client name].

Be professional but not formal. Don't summarize the whole meeting, they were there. Just confirm what we agreed on, what I'm doing next, and when they'll hear from me again.

[paste transcript]`}
              />
            </div>

            {/* ── Projects ── */}
            <SectionHeading id="projects">Searchable history with Claude Projects</SectionHeading>
            <SectionSubhead>This is where Claude beats Otter's search feature completely.</SectionSubhead>

            <p className="text-[15px] text-white/55 leading-relaxed mb-6">
              Claude Pro's Projects feature lets you create a persistent context that remembers everything you add to it. Upload your meeting transcripts as files and Claude can search across all of them. Otter charges for search; Claude already has it.
            </p>

            <div className="divide-y divide-white/[0.06] mb-8">
              <Step n="1" title='Create a Project in Claude.ai'>
                <p>In Claude.ai, look for "Projects" in the left sidebar. Create a new one and name it something like "Client: [name]" or "Team standups" or "Sales calls", whatever bucket makes sense for the meetings you're logging.</p>
              </Step>
              <Step n="2" title="Add instructions for how you want Claude to behave">
                <p>In the Project settings, there's a field called "Project instructions", this is the system prompt that applies to every conversation you have inside this Project. Paste this as a starting point:</p>
                <PromptBlock
                  label="project instructions (paste into Project settings)"
                  code={`You are my meeting assistant for [context, e.g. "client calls with Acme Corp"].

I'll add meeting transcripts to this project as files. When I ask questions, search across all of them.

Defaults unless I say otherwise:
- Action items: explicit commitments only, not inferred
- Summaries: bullet lists, no padding
- Tone for emails: direct, not corporate

My name in transcripts is [your name].`}
                />
              </Step>
              <Step n="3" title="Upload your transcript files">
                <p>In the Project, click "Add content" or the file upload button and add your Markdown exports. You can upload a batch at once. Claude indexes them automatically.</p>
                <p>Going forward, after each meeting: export the transcript, upload it to the relevant Project. Takes 30 seconds.</p>
              </Step>
              <Step n="4" title="Query across all your meetings">
                <p>Now you can ask questions that span your whole history:</p>
                <PromptBlock
                  label="cross-meeting queries"
                  code={`What commitments have I made to this client that I haven't followed up on yet?

What was the last thing we decided about the pricing model?

What did Sarah say about the Q3 timeline across all our calls?

Which meetings mentioned the Johnson account?`}
                />
              </Step>
            </div>

            <Callout>
              A separate Project per client or per recurring meeting type works better than one giant "All Meetings" project. Claude's context window is large but not infinite, keeping Projects focused gives you better answers.
            </Callout>

            {/* ── CRM ── */}
            <SectionHeading id="crm">CRM data extraction</SectionHeading>
            <SectionSubhead>The manual data entry you do after calls. Automated.</SectionSubhead>

            <p className="text-[15px] text-white/55 leading-relaxed mb-6">
              This prompt returns structured JSON you can paste into your CRM's import tool or feed to a Zapier/Make workflow. Adjust the fields to match whatever your CRM actually uses.
            </p>

            <PromptBlock
              label="CRM extraction: JSON output"
              code={`Extract CRM data from this transcript and return as JSON:

{
  "contact_names": [],
  "company": "",
  "deal_stage": "",
  "my_commitments": [{ "task": "", "deadline": "" }],
  "their_pain_points": [],
  "objections_raised": [],
  "next_touchpoint": "",
  "sentiment": "positive | neutral | negative"
}

Be literal. Only include things explicitly stated. Leave fields empty if not mentioned.

[paste transcript]`}
            />

            <div className="mt-4">
              <PromptBlock
                label="CRM extraction: HubSpot note format"
                code={`Write a HubSpot call note from this transcript. Format:

Meeting date: [date]
Attendees: [names]
Duration: [if mentioned]

Summary (2-3 sentences max):

Key points discussed:
-

Next steps:
-

[paste transcript]`}
              />
            </div>

            {/* ── agentHook ── */}
            <SectionHeading id="agenthook">agentHook for automation</SectionHeading>
            <SectionSubhead>For people who want to skip the paste-and-prompt loop entirely.</SectionSubhead>

            <p className="text-[15px] text-white/55 leading-relaxed mb-4">
              Turingram's agentHook export produces structured JSON with speaker labels, start and end timestamps, and clean text per segment. If you use Claude Code or any automation pipeline, you can process transcripts programmatically without any prompt engineering on the transcript itself.
            </p>

            <PromptBlock
              label="read agentHook JSON in Claude Code"
              code={`const fs = require('fs');
const transcript = JSON.parse(
  fs.readFileSync('./transcripts/meeting-2026-05-31.json', 'utf8')
);

// transcript.segments is an array of:
// { speaker, startTime, endTime, text }
// transcript.title, transcript.startedAt, transcript.endedAt

const myLines = transcript.segments
  .filter(s => s.speaker === 'Jared')
  .map(s => s.text)
  .join('\\n');`}
            />

            <p className="text-[15px] text-white/55 leading-relaxed mt-4">
              The format is stable, Turingram writes the same schema every time, so you can build pipelines that process new transcripts automatically as they appear in the export folder.
            </p>

            <GuideFooterCTA />
          </main>
        </div>
      </div>
    </div>
  )
}
