import { useState, useEffect } from 'react'
import { Link } from 'react-router'
import { motion, useReducedMotion } from 'motion/react'
import {
  Waveform,
  Robot,
  Microphone,
  FileCode,
  ArrowSquareOut,
  CheckCircle,
  CaretDown,
  ArrowDown,
  ArrowRight,
} from '@phosphor-icons/react'
import PromptBlock from './components/PromptBlock.jsx'
import ComparisonTable from './components/ComparisonTable.jsx'

// Design read: indie Electron desktop landing for technically capable sovereign professionals.
// Synthwave/cyberpunk-light dark aesthetic. Space Grotesk. Single accent: celeste #40EFAB.
// DESIGN_VARIANCE: 9 | MOTION_INTENSITY: 6 | VISUAL_DENSITY: 4

const WAVEFORM_BARS = [
  { h: 28, delay: 0 },
  { h: 60, delay: 0.14 },
  { h: 44, delay: 0.28 },
  { h: 76, delay: 0.07 },
  { h: 52, delay: 0.21 },
  { h: 92, delay: 0.35 },
  { h: 68, delay: 0.10 },
  { h: 40, delay: 0.24 },
  { h: 84, delay: 0.42 },
]

function AudioViz() {
  const reduce = useReducedMotion()
  return (
    <div className="flex items-end justify-center gap-[6px]" style={{ height: 92 }}>
      {WAVEFORM_BARS.map((bar, i) => (
        <motion.div
          key={i}
          className="w-[9px] rounded-full bg-[#40EFAB]"
          style={{ height: bar.h }}
          {...(!reduce && {
            animate: { scaleY: [1, 0.22, 1.15, 0.55, 1] },
            transition: {
              duration: 2.6,
              delay: bar.delay,
              repeat: Infinity,
              ease: 'easeInOut',
            },
          })}
        />
      ))}
    </div>
  )
}

function GrainOverlay() {
  return (
    <div
      aria-hidden
      className="fixed inset-0 z-[60] pointer-events-none select-none"
      style={{
        opacity: 0.045,
        backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='256' height='256'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='256' height='256' filter='url(%23n)'/%3E%3C/svg%3E")`,
        backgroundRepeat: 'repeat',
        backgroundSize: '256px 256px',
      }}
    />
  )
}

function FAQItem({ q, a }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="border-b border-white/10">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex justify-between items-center py-5 text-left gap-4 cursor-pointer"
      >
        <span className="text-[16px] font-medium text-white">{q}</span>
        <CaretDown
          size={16}
          weight="bold"
          className={`shrink-0 text-[#40EFAB] transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && (
        <p className="pb-5 text-[14px] text-white/55 leading-relaxed max-w-[58ch]">{a}</p>
      )}
    </div>
  )
}

const AI_TABS = [
  {
    id: 'claude',
    label: 'Claude',
    guideUrl: '/guide/claude',
    note: 'Claude handles structured JSON well. Use the agentHook export for machine-readable output, or paste Markdown for a quick read. If you keep a Claude Project for client work, upload your exports as files. They index automatically.',
    prompts: [
      {
        label: 'Summary + action items',
        code: `Summarize this meeting. Key decisions, action items with owners, and any open questions still unresolved.

[paste transcript or agentHook JSON]`,
      },
      {
        label: 'CRM extraction',
        code: `From this transcript, extract as JSON:
- contacts: names and how they were mentioned
- my_commitments: what I said I'd do, with deadline if stated
- open_items: things needing follow-up before next touchpoint

[paste transcript]`,
      },
    ],
  },
  {
    id: 'chatgpt',
    label: 'ChatGPT',
    guideUrl: '/guide/chatgpt',
    note: "Use the Markdown export. If you have a custom GPT built around your workflow, it picks up the format without any prompt engineering. ChatGPT's memory feature will start tracking recurring contacts and commitments across meetings once you've run a few.",
    prompts: [
      {
        label: 'Full meeting digest',
        code: `Here's a meeting transcript. Give me:
1. A 3-bullet executive summary
2. Action items with owners (from the transcript, not inferred)
3. A follow-up email I can send to attendees

[paste transcript]`,
      },
      {
        label: 'Decision log',
        code: `Extract every decision made in this meeting. For each: what was decided, who made the call (if stated), and any rationale given.

[paste transcript]`,
      },
    ],
  },
  {
    id: 'gemini',
    label: 'Gemini',
    guideUrl: '/guide/gemini',
    note: 'Export as plain text or Markdown. In NotebookLM, upload multiple meeting transcripts as sources and query across all of them, which makes it useful for tracking commitments over time. Gemini in Docs drops the summary straight into a shareable document.',
    prompts: [
      {
        label: 'Google Workspace integration',
        code: `Summarize this meeting and list the action items as a Google Tasks checklist. Note any dates or deadlines mentioned.

[paste transcript]`,
      },
      {
        label: 'NotebookLM (multi-meeting)',
        code: `(Upload transcript files to NotebookLM as sources, then ask:)

What commitments have I made in my recent meetings that don't have a follow-up yet?`,
      },
    ],
  },
]

const FEATURES = [
  {
    Icon: FileCode,
    title: 'agentHook JSON',
    body: 'Timestamped segments with speaker labels. Built for AI agents, not document storage.',
    large: true,
    highlight: true,
    snippet: `{
  "title": "Q2 strategy sync",
  "segments": [{
    "speaker": "Jared",
    "startTime": 0.0,
    "endTime": 4.2,
    "text": "...transcribes it without a bot in the call"
  }]
}`,
  },
  {
    Icon: Waveform,
    title: 'Dual-channel capture',
    body: 'Mic and system audio on separate tracks. PipeWire echo cancellation keeps voices clean across the call.',
    large: false,
    highlight: false,
  },
  {
    Icon: Robot,
    title: 'Speaker diarization',
    body: 'Every segment comes back with a speaker attached. Nothing to configure, and you put real names on the labels afterwards.',
    large: false,
    highlight: false,
  },
  {
    Icon: Microphone,
    title: 'Deepgram nova-3',
    body: 'Transcription runs on Deepgram. No model downloads, no GPU, and your laptop fan stays where it was.',
    large: false,
    highlight: false,
  },
  {
    Icon: ArrowSquareOut,
    title: 'Four export formats',
    body: 'Markdown, JSON, SRT, agentHook. Same meeting, different shapes for different tools.',
    large: false,
    highlight: false,
  },
]

const FAQS = [
  {
    q: 'Does it need an internet connection?',
    a: 'For transcription, yes. The capture itself is local, so the recording is safe on disk whether or not you have a connection when the call happens.',
  },
  {
    q: 'Which platforms does it support?',
    a: 'Linux (deb and AppImage), Windows, and macOS. All three are built from the same codebase.',
  },
  {
    q: "What's agentHook format?",
    a: 'Structured JSON with speaker labels, timestamps, and transcript segments. Designed to feed directly into AI agents and automations. Drop it into a Claude Code session or pipe it to any workflow that reads JSON, no human parsing step required.',
  },
  {
    q: 'What does it cost?',
    a: 'Turingram is free and open source under GPL-3.0. You use your own Deepgram and Gemini API keys and pay those providers directly for what you use. After every 12 hours of recording, the app asks you to buy the developer a drink. One drink stops the asking on that computer.',
  },
  {
    q: 'Where does my audio go?',
    a: 'The audio goes to Deepgram for transcription. The transcript text then goes to Google Gemini for the title, summary and action items. Both requests use your own API keys, and nothing passes through a Turingram server. The results are written into a folder you pick on your own machine, in formats you can open without an account.',
  },
  {
    q: 'How does speaker identification work?',
    a: 'Turingram records your microphone and the system audio on separate channels, so your own words are certain rather than guessed, and Deepgram splits the far side into per-speaker segments. You put names on those labels after the fact.',
  },
]

const REPO_URL = 'https://github.com/jared-the-automator/turingram'
const DOWNLOAD_URL = `${REPO_URL}/releases/latest`

function DownloadLink({ className }) {
  return (
    <a
      href={DOWNLOAD_URL}
      className={className || 'w-full flex items-center justify-center py-4 rounded-xl bg-[#40EFAB] text-[#020210] font-bold text-[15px] hover:bg-[#2cd492] transition-colors'}
    >
      Download Turingram
    </a>
  )
}

const fadeUp = {
  initial: { opacity: 0, y: 24 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, amount: 0.35 },
  transition: { duration: 0.6, ease: [0.16, 1, 0.3, 1] },
}

function scrollTo(id) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' })
}

function AIPromptsSection() {
  const [active, setActive] = useState('claude')
  const tab = AI_TABS.find(t => t.id === active)

  return (
    <section id="ai-tools" className="py-28 border-t border-white/5">
      <div className="max-w-7xl mx-auto px-6 md:px-12">
        <motion.div {...fadeUp} className="max-w-3xl mb-12">
          <h2 className="text-3xl md:text-4xl font-bold tracking-tight mb-5">
            What to do with the transcript
          </h2>
          <p className="text-[17px] text-white/55 leading-relaxed">
            Most transcription subscriptions run a few prompts over your transcript and call them AI features. These prompts do the same thing in whatever tool you already use.
          </p>
        </motion.div>

        <motion.div {...fadeUp} transition={{ duration: 0.5, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}>
          <div className="flex gap-2 mb-8">
            {AI_TABS.map(t => (
              <button
                key={t.id}
                onClick={() => setActive(t.id)}
                className={`px-4 py-2 rounded-xl text-[13px] font-semibold transition-colors cursor-pointer ${
                  active === t.id
                    ? 'bg-[#40EFAB] text-[#020210]'
                    : 'bg-white/[0.06] text-white/50 hover:text-white/80'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-5 gap-8 items-start">
            <div className="lg:col-span-2">
              <p className="text-[15px] text-white/55 leading-relaxed mb-5">{tab.note}</p>
              <Link
                to={tab.guideUrl}
                className="inline-flex items-center gap-1.5 text-[13px] text-[#40EFAB] hover:text-white transition-colors"
              >
                Full setup guide <ArrowRight size={13} />
              </Link>
            </div>
            <div className="lg:col-span-3 flex flex-col gap-4">
              {tab.prompts.map(p => (
                <PromptBlock key={p.label} label={p.label} code={p.code} />
              ))}
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  )
}

export default function App() {
  return (
    <div className="bg-[#020210] text-white">
      <GrainOverlay />

      {/* ── Nav ── */}
      <nav className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-6 md:px-12 h-16 bg-[#020210]/90 backdrop-blur-md border-b border-white/5">
        <div className="flex items-center gap-2.5">
          <img src="/logo.svg" alt="Turingram" className="h-8 w-8" />
          <span className="font-semibold text-[17px] tracking-tight">Turingram</span>
        </div>
        <DownloadLink className="text-[13px] font-bold px-5 py-2 rounded-xl bg-[#40EFAB] text-[#020210] hover:bg-[#2cd492] transition-colors whitespace-nowrap" />
      </nav>

      {/* ── Hero ── */}
      <section className="min-h-[100dvh] flex items-center pt-16 relative overflow-hidden">
        <div aria-hidden className="absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_65%_40%,rgba(64,239,171,0.06)_0%,transparent_65%)] pointer-events-none" />
        <div className="max-w-7xl mx-auto px-6 md:px-12 w-full grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-20 items-center py-20">
          <motion.div
            initial={{ opacity: 0, y: 32 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
          >
            <h1 className="text-5xl md:text-6xl font-bold tracking-tight leading-[1.1] mb-6 text-balance">
              <span className="text-white">Turingram delivers the transcript,</span>
              {' '}
              <span className="text-[#40EFAB]">your own AI can take it from there.</span>
            </h1>
            <p className="text-[17px] text-white/55 max-w-[46ch] mb-10 leading-relaxed">
              No bot joins the call. Turingram runs in the background, captures your mic and system audio, diarizes the speakers, and exports agent-ready JSON. Drop it into Claude, ChatGPT, or Gemini. Turingram is free and open source, and it runs on your own API keys.
            </p>
            <div className="flex items-center gap-5 flex-wrap">
              <button
                onClick={() => scrollTo('get')}
                className="inline-flex items-center px-6 py-3.5 rounded-xl bg-[#40EFAB] text-[#020210] font-bold text-[15px] hover:bg-[#2cd492] transition-colors cursor-pointer"
              >
                Get Turingram
              </button>
              <button
                onClick={() => scrollTo('ai-tools')}
                className="flex items-center gap-1.5 text-[13px] text-white/60 hover:text-white/65 transition-colors cursor-pointer"
              >
                Show me the prompts <ArrowDown size={12} />
              </button>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.8, delay: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className="relative hidden lg:flex flex-col items-center justify-center bg-[#0d0926] rounded-2xl border border-[#40EFAB]/18 px-10 py-16 overflow-hidden"
          >
            <div aria-hidden className="absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_0%,rgba(64,239,171,0.10)_0%,transparent_70%)] pointer-events-none" />
            <div aria-hidden className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-[#40EFAB]/20 to-transparent" />
            <AudioViz />
            <p className="mt-9 text-[10px] text-white/60 font-mono tracking-[0.22em] uppercase relative z-10">
              Two channels, no bot
            </p>
          </motion.div>
        </div>
      </section>

      {/* ── The overlap argument ── */}
      <section className="py-28 border-t border-white/5 bg-[#0a0820]">
        <div className="max-w-7xl mx-auto px-6 md:px-12">
          <motion.div {...fadeUp}>
            <h2 className="text-4xl md:text-5xl lg:text-6xl font-bold tracking-tight leading-[1.0] mb-10">
              You're already<br />
              <span className="text-[#40EFAB]">paying for the AI.</span>
            </h2>
            <p className="text-[16px] text-white/55 leading-relaxed max-w-[54ch]">
              Claude, ChatGPT, and Gemini all summarize meetings, extract action items, and draft follow-up emails. They work from the raw transcript. The transcript was the only thing missing.
            </p>
          </motion.div>
        </div>
      </section>

      {/* ── AI Prompts (tabbed: Claude / ChatGPT / Gemini) ── */}
      <AIPromptsSection />

      {/* ── How it works ── */}
      <section id="how-it-works" className="py-28 border-t border-white/5 bg-[#0a0820]">
        <div className="max-w-7xl mx-auto px-6 md:px-12">
          <motion.h2 {...fadeUp} className="text-3xl md:text-4xl font-bold tracking-tight mb-16">
            How it works
          </motion.h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-10 md:gap-12">
            {[
              {
                n: '01',
                title: 'Hit record',
                body: 'Turingram captures your mic and system audio on separate channels. Nothing joins the call. Start and stop whenever.',
              },
              {
                n: '02',
                title: 'It comes back labelled',
                body: 'The recording goes up to Deepgram and returns as segments with a speaker on each one. Your own channel is never in doubt.',
              },
              {
                n: '03',
                title: 'Export and use it',
                body: 'Markdown for notes, SRT for video sync, or agentHook JSON straight into your AI tools.',
              },
            ].map((s, i) => (
              <motion.div
                key={s.n}
                {...fadeUp}
                transition={{ duration: 0.5, delay: i * 0.1, ease: [0.16, 1, 0.3, 1] }}
                className="flex flex-col"
              >
                <span aria-hidden="true" className="text-[clamp(5rem,12vw,8rem)] font-bold text-[#40EFAB]/50 font-mono leading-none mb-3 select-none">{s.n}</span>
                <h3 className="text-xl font-semibold mb-2">{s.title}</h3>
                <p className="text-[15px] text-white/50 leading-relaxed max-w-[32ch]">{s.body}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Features bento ── */}
      <section id="features" className="py-28 border-t border-white/5">
        <div className="max-w-7xl mx-auto px-6 md:px-12">
          <motion.h2 {...fadeUp} className="text-3xl md:text-4xl font-bold tracking-tight mb-14">
            What it does
          </motion.h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {FEATURES.map((f, i) => (
              <motion.div
                key={f.title}
                {...fadeUp}
                transition={{ duration: 0.5, delay: i * 0.07, ease: [0.16, 1, 0.3, 1] }}
                className={[
                  'rounded-xl border flex flex-col gap-4',
                  f.large ? 'lg:col-span-2 p-7' : 'p-6',
                  f.highlight
                    ? 'border-[#40EFAB]/20 bg-gradient-to-br from-[#40EFAB]/8 via-[#40EFAB]/4 to-transparent'
                    : 'border-white/[0.07] bg-[#0d0926]/80',
                ].join(' ')}
              >
                <f.Icon
                  size={24}
                  weight={f.highlight ? 'fill' : 'regular'}
                  className={f.highlight ? 'text-[#40EFAB]' : 'text-white/60'}
                />
                <div>
                  <h3 className="font-semibold text-[15px] mb-1.5 text-white">{f.title}</h3>
                  <p className="text-[13px] text-white/50 leading-relaxed">{f.body}</p>
                </div>
                {f.snippet && (
                  <pre className="mt-1 rounded-lg bg-[#020210] border border-white/[0.07] p-4 text-[11px] font-mono text-[#40EFAB]/65 leading-relaxed overflow-x-auto whitespace-pre-wrap">
                    {f.snippet}
                  </pre>
                )}
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Privacy callout (matter-of-fact) ── */}
      <section className="py-20 border-t border-white/5 bg-[#0a0820]">
        <div className="max-w-7xl mx-auto px-6 md:px-12">
          <motion.div {...fadeUp} className="max-w-2xl">
            <p className="text-3xl md:text-4xl font-semibold text-white mb-6 leading-[1.2] max-w-[24ch]">
              Your meetings are a folder, not somebody's library.
            </p>
            <p className="text-[15px] text-white/60 leading-relaxed">
              The audio goes to Deepgram and the transcript text goes to Gemini, each on your own key. Everything that comes back is written into a directory you chose, as Markdown, JSON, and SRT you can open with anything. The transcripts stay yours, because they were never anywhere you had to log in to reach.
            </p>
          </motion.div>
        </div>
      </section>

      {/* ── Pricing / Download ── */}
      <section id="get" className="py-28 border-t border-white/5">
        <div className="max-w-7xl mx-auto px-6 md:px-12">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-start">
            <motion.div {...fadeUp}>
              <h2 className="text-4xl md:text-5xl font-bold tracking-tight mb-5">
                Free, and open source.
              </h2>
              <p className="text-[15px] text-white/60 leading-relaxed">
                Turingram costs nothing, and the source code is on GitHub under GPL-3.0. You pay Deepgram and Google directly for what you use. After every 12 hours of recording, the app asks you to buy the developer a drink.
              </p>
            </motion.div>

            <motion.div
              {...fadeUp}
              transition={{ duration: 0.6, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
              className="rounded-2xl border border-[#40EFAB]/18 bg-gradient-to-b from-[#40EFAB]/[0.06] to-[#0d0926] p-8"
            >
              <div className="flex items-baseline gap-2.5 mb-7">
                <span className="text-5xl font-bold">Free</span>
                <span className="text-white/60 text-[14px]">GPL-3.0</span>
              </div>
              <ul className="space-y-3 mb-8">
                {[
                  'Linux (deb + AppImage), Windows, macOS',
                  'All four export formats including agentHook JSON',
                  'Deepgram nova-3 transcription with speaker labels',
                  'Mic and system audio captured on separate channels',
                  'Transcripts written to a folder you pick',
                  'Your own Deepgram and Gemini keys, no account',
                ].map((item) => (
                  <li key={item} className="flex items-center gap-3 text-[14px] text-white/60">
                    <CheckCircle size={14} weight="fill" className="text-[#40EFAB] shrink-0" />
                    {item}
                  </li>
                ))}
              </ul>
              <DownloadLink />
              <p className="text-center text-[11px] text-white/60 mt-3">
                <a href={REPO_URL} className="hover:text-white/80 transition-colors">Read the source code on GitHub.</a>
              </p>
            </motion.div>
          </div>
          <ComparisonTable />
        </div>
      </section>

      {/* ── FAQ ── */}
      <section id="faq" className="py-28 border-t border-white/5 bg-[#0a0820]">
        <div className="max-w-2xl mx-auto px-6 md:px-12">
          <motion.h2 {...fadeUp} className="text-3xl font-bold tracking-tight mb-12">
            Questions
          </motion.h2>
          {FAQS.map((f) => (
            <FAQItem key={f.q} q={f.q} a={f.a} />
          ))}
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="py-10 border-t border-white/5">
        <div className="max-w-7xl mx-auto px-6 md:px-12 flex items-center justify-center gap-4">
          <img src="/logo.svg" alt="Turingram" className="h-6 w-6" />
          <a
            href="https://biggerfish.io"
            className="text-[12px] text-white/60 hover:text-white/80 transition-colors"
          >
            Turingram by Bigger Fish Intelligent Automation
          </a>
        </div>
      </footer>

    </div>
  )
}
