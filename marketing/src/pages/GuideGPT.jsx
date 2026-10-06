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
  { id: 'quick-start', label: 'Quick start (no setup)' },
  { id: 'custom-gpt', label: 'Custom GPT setup' },
  { id: 'summary', label: 'Meeting summary' },
  { id: 'action-items', label: 'Action items' },
  { id: 'followup-email', label: 'Follow-up email' },
  { id: 'memory', label: 'Memory for recurring meetings' },
  { id: 'crm', label: 'CRM data extraction' },
]

export default function GuideGPT() {
  return (
    <div className="bg-[#020210] text-white min-h-screen">
      <GuideNav />

      <div className="max-w-7xl mx-auto px-6 md:px-12 py-14">
        <div className="grid grid-cols-1 lg:grid-cols-[200px_1fr] gap-16">

          <TOC items={TOC_ITEMS} />

          <main className="min-w-0 max-w-3xl">
            <p className="text-[12px] text-[#40EFAB] font-mono uppercase tracking-widest mb-4">Guide</p>
            <h1 className="text-3xl md:text-4xl font-bold tracking-tight leading-tight mb-4">
              Meeting notes with ChatGPT
            </h1>
            <p className="text-[17px] text-white/55 leading-relaxed mb-12">
              Record with Turingram, export the transcript, and use ChatGPT for the analysis. Two approaches: paste-and-prompt for one-off use, or build a custom GPT that handles your whole workflow with no prompting at all. The second approach is about 30 minutes of setup, then zero effort per meeting.
            </p>

            {/* ── What you get ── */}
            <SectionHeading id="what-you-get">What you get</SectionHeading>
            <SectionSubhead>What Turingram and ChatGPT can do together.</SectionSubhead>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-12">
              {[
                ['Meeting summary', 'Custom GPT or prompt'],
                ['Action items with owners', 'Prompt (copy below)'],
                ['Follow-up email draft', 'Prompt (copy below)'],
                ['Searchable history', 'ChatGPT Memory + file uploads'],
                ['CRM data extraction', 'Structured output prompt'],
                ['Recurring meeting format', 'Custom GPT instructions'],
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
            <SectionSubhead>Free tier works. Plus unlocks the best parts.</SectionSubhead>

            <div className="space-y-3 mb-12">
              <div className="rounded-lg border border-white/[0.07] bg-[#0d0926] p-4">
                <p className="text-[14px] font-semibold mb-1">Turingram</p>
                <p className="text-[13px] text-white/65">Install and record one meeting. You need an actual transcript to test with before setting up the custom GPT.</p>
              </div>
              <div className="rounded-lg border border-white/[0.07] bg-[#0d0926] p-4">
                <p className="text-[14px] font-semibold mb-1">ChatGPT account</p>
                <p className="text-[13px] text-white/65">Free works for paste-and-prompt. ChatGPT Plus ($20/month) unlocks custom GPTs and the Memory feature. Both are covered in this guide, start free and upgrade if you want the persistent workflow.</p>
              </div>
            </div>

            {/* ── Record and export ── */}
            <SectionHeading id="record-export">Record your meeting and export the transcript</SectionHeading>
            <SectionSubhead>Same process before every meeting.</SectionSubhead>

            <div className="divide-y divide-white/[0.06]">
              <Step n="1" title="Start recording before the call">
                <p>Open Turingram and click record before you join the meeting. It runs in the background and captures both your mic and system audio on separate channels.</p>
              </Step>
              <Step n="2" title="Stop and wait for transcription">
                <p>Click stop after the call. The recording goes to Deepgram to be transcribed. Speaker labels appear when it finishes. Assign names if needed.</p>
              </Step>
              <Step n="3" title="Export as Markdown">
                <p>Click Export and choose Markdown. This is the format that pastes cleanly into ChatGPT. The plain text export also works if you prefer a cleaner paste without the Markdown formatting.</p>
              </Step>
            </div>

            {/* ── Quick start ── */}
            <SectionHeading id="quick-start">Quick start: no setup required</SectionHeading>
            <SectionSubhead>If you just want to try it before setting anything up.</SectionSubhead>

            <p className="text-[15px] text-white/55 leading-relaxed mb-6">
              Open chatgpt.com, start a new conversation, paste your transcript, and run this prompt. That's it. No custom GPT needed for one-off use.
            </p>

            <PromptBlock
              label="one-shot meeting analysis"
              code={`Here's a meeting transcript. Give me:

1. A 3-bullet summary of what was discussed and decided
2. Action items, [owner name]: [task], deadline if mentioned
3. A short follow-up email I can send to attendees

[paste transcript here]`}
            />

            <p className="text-[15px] text-white/55 leading-relaxed mt-6">
              If that works for how you need to use it, you're done. The rest of this guide is about removing the copy-paste step entirely.
            </p>

            {/* ── Custom GPT ── */}
            <SectionHeading id="custom-gpt">Custom GPT setup</SectionHeading>
            <SectionSubhead>Set this up once. Every meeting after that is one paste, zero prompting.</SectionSubhead>

            <p className="text-[15px] text-white/55 leading-relaxed mb-6">
              A custom GPT is just a saved system prompt with a name. That's literally all it is. When you open "Meeting Notes GPT" and paste a transcript, ChatGPT already knows what you want done with it, you defined that once in the instructions.
            </p>

            <div className="divide-y divide-white/[0.06] mb-8">
              <Step n="1" title="Open the GPT builder">
                <p>In ChatGPT, click your profile picture in the top right, then "My GPTs", then "Create a GPT." You'll land in the GPT builder.</p>
              </Step>
              <Step n="2" title="Skip the chat interface, go straight to Configure">
                <p>There are two tabs: "Create" (a chatbot that builds the GPT for you) and "Configure" (where you write the instructions directly). Go to Configure.</p>
              </Step>
              <Step n="3" title="Set a name and paste your instructions">
                <p>Name it something like "Meeting Notes" or "Client Call Notes." Then paste this into the Instructions field. Edit it to match how you actually work:</p>
                <PromptBlock
                  label="custom GPT instructions"
                  code={`You process meeting transcripts. When I give you a transcript, automatically do all of the following without being asked:

1. SUMMARY
Write a summary of what was decided and what's still open. Bullet points, no padding. Keep it under 100 words.

2. ACTION ITEMS
List every explicit commitment made in the meeting. Format:
[Name]: [task], [deadline if stated]
Only include things someone actually said they'd do.

3. FOLLOW-UP EMAIL
Write a short follow-up email to the attendees. Direct and human, not corporate. Confirm decisions and next steps only.

My name in transcripts is [your name]. Flag anything I committed to separately at the top.

Ask me if I want anything reformatted after you're done.`}
                />
              </Step>
              <Step n="4" title="Save and test it">
                <p>Click Save (top right), set visibility to "Only me," and save. Then open the GPT from "My GPTs," paste a real transcript, and hit enter. You should get all three outputs with no prompting.</p>
                <Callout>
                  Iterate on the instructions based on what the first few outputs look like. The instructions field is a live system prompt, change it whenever the output format stops fitting your workflow.
                </Callout>
              </Step>
            </div>

            {/* ── Summary ── */}
            <SectionHeading id="summary">Meeting summary</SectionHeading>
            <SectionSubhead>If you're using the custom GPT, this is automatic. If not, here's the standalone prompt.</SectionSubhead>

            <PromptBlock
              label="meeting summary"
              code={`Summarize this meeting. Key decisions, what's unresolved, and what happens next. Bullet points, under 150 words total.

[paste transcript]`}
            />

            {/* ── Action items ── */}
            <SectionHeading id="action-items">Action items</SectionHeading>
            <SectionSubhead>Pull explicit commitments from any meeting.</SectionSubhead>

            <p className="text-[15px] text-white/55 leading-relaxed mb-6">
              The prompt below only extracts commitments someone explicitly stated. Add or remove that constraint depending on what your meeting type calls for.
            </p>

            <PromptBlock
              label="action items: explicit only"
              code={`Extract action items from this transcript. Include only commitments someone explicitly made. Don't infer. If no clear owner was stated, mark it as [unassigned].

Format: [Owner]: [task], [deadline if mentioned]

[paste transcript]`}
            />

            {/* ── Follow-up email ── */}
            <SectionHeading id="followup-email">Follow-up email</SectionHeading>
            <SectionSubhead>A usable first draft in about 10 seconds.</SectionSubhead>

            <PromptBlock
              label="follow-up email"
              code={`Write a follow-up email to everyone in this meeting. Short. Confirm what was decided, list who's doing what, say when we reconnect if a date was mentioned. Write it like a person, not a newsletter.

[paste transcript]`}
            />

            <div className="mt-4">
              <PromptBlock
                label="follow-up email: client-facing"
                code={`Write a client-facing follow-up for this call. The client is [name]. Don't recap the whole call, they were there. Confirm what I'm delivering and when they'll hear from me. Professional tone but not stiff.

[paste transcript]`}
              />
            </div>

            {/* ── Memory ── */}
            <SectionHeading id="memory">Memory for recurring meetings</SectionHeading>
            <SectionSubhead>ChatGPT Plus's memory feature builds context across sessions.</SectionSubhead>

            <p className="text-[15px] text-white/55 leading-relaxed mb-6">
              ChatGPT Plus has a Memory feature that stores facts across conversations. It's not as structured as Claude Projects, but it builds up automatically as you use it.
            </p>

            <div className="divide-y divide-white/[0.06] mb-8">
              <Step n="1" title="Enable Memory">
                <p>Go to Settings in ChatGPT, then Personalization, then Memory. Turn it on. From this point, ChatGPT will start saving context across your conversations.</p>
              </Step>
              <Step n="2" title="Tell it what to remember">
                <p>In a regular conversation (not inside your custom GPT), tell it:</p>
                <PromptBlock
                  label="memory setup"
                  code={`Remember this about my meeting workflow:
- I use Turingram for transcription
- My name is [your name]
- [Client name] is a client I meet with bi-weekly
- I want action items in [format you prefer]
- I always need a follow-up email after client calls`}
                />
              </Step>
              <Step n="3" title="Query across past context">
                <p>After a few meetings, ask:</p>
                <PromptBlock
                  label="cross-meeting queries"
                  code={`What commitments have I made in recent meetings that I haven't mentioned completing?

What were the main topics from my last three client calls?`}
                />
                <p>Memory is imperfect compared to Claude Projects because it doesn't have the full transcripts to search, it only has what ChatGPT remembered. For full searchable history, see the Claude guide instead.</p>
              </Step>
            </div>

            {/* ── CRM ── */}
            <SectionHeading id="crm">CRM data extraction</SectionHeading>
            <SectionSubhead>Structured output you can import or feed to an automation.</SectionSubhead>

            <PromptBlock
              label="CRM data: JSON output"
              code={`Extract CRM data from this transcript. Return JSON:

{
  "contacts": [],
  "company": "",
  "my_commitments": [{ "task": "", "deadline": "" }],
  "their_commitments": [{ "name": "", "task": "" }],
  "pain_points": [],
  "objections": [],
  "next_meeting": "",
  "deal_stage_signal": ""
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
