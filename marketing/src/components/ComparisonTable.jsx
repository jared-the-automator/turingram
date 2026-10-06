import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { CheckCircle, Minus, CaretDown, Clock } from '@phosphor-icons/react'

// Feature matrix — maintained manually. Prices come from /prices.json, also edited by hand.
// Values: true = yes, false = no, string = custom label, 'price' = dynamic price cell
// Column order: Turingram first.
const ROWS = [
  // Pricing — Turingram wins first
  { cat: 'Pricing', label: 'Free and open source',    turingram: true,    otter: false,   fireflies: false   },
  { cat: 'Pricing', label: 'Monthly subscription',    turingram: false,   otter: 'price', fireflies: 'price' },
  { cat: 'Pricing', label: 'Free tier',               turingram: true,    otter: true,    fireflies: true    },

  // Recording & privacy — Turingram wins first, losses last
  { cat: 'Recording & privacy', label: 'Records system audio',           turingram: true,  otter: false, fireflies: false },
  { cat: 'Recording & privacy', label: 'Transcripts stay in your folder', turingram: true,  otter: false, fireflies: false },
  { cat: 'Recording & privacy', label: 'Recording works with no signal',  turingram: true,  otter: false, fireflies: false },
  { cat: 'Recording & privacy', label: 'Account required',               turingram: false, otter: true,  fireflies: true  },
  { cat: 'Recording & privacy', label: 'Bot joins your call',            turingram: false, otter: true,  fireflies: true  },

  // Transcription
  { cat: 'Transcription', label: 'Speaker diarization', turingram: true,  otter: true, fireflies: true  },
  { cat: 'Transcription', label: 'Multiple languages',   turingram: false, otter: true, fireflies: true  },

  // AI features — summaries and action items are built in (Gemini); the rest is bring-your-own
  { cat: 'AI features', label: 'Meeting summaries',              turingram: true,      otter: true, fireflies: true },
  { cat: 'AI features', label: 'Action item extraction',          turingram: true,      otter: true, fireflies: true },
  { cat: 'AI features', label: 'Follow-up email draft',           turingram: 'Your AI', otter: true, fireflies: true },
  { cat: 'AI features', label: 'Contact & deal data extraction',  turingram: 'Your AI', otter: true, fireflies: true },
  { cat: 'AI features', label: 'Cross-meeting search',            turingram: 'Your AI', otter: true, fireflies: true },

  // Exports — Turingram-unique first
  { cat: 'Exports', label: 'agentHook JSON (AI-structured)', turingram: true,       otter: false, fireflies: false },
  { cat: 'Exports', label: 'JSON',                           turingram: true,       otter: false, fireflies: true  },
  { cat: 'Exports', label: 'Plain text / Markdown',          turingram: true,       otter: true,  fireflies: true  },
  { cat: 'Exports', label: 'SRT subtitles',                  turingram: true,       otter: true,  fireflies: true  },
  { cat: 'Exports', label: 'PDF / DOCX',                     turingram: 'Planned',  otter: true,  fireflies: true  },

  // Integrations — Turingram bridges are via LLM tools, not native app integrations
  { cat: 'Integrations', label: 'Calendar (Google, Outlook)', turingram: 'Via Gemini',    otter: true,  fireflies: true  },
  { cat: 'Integrations', label: 'CRM sync (native push)',     turingram: false,            otter: true,  fireflies: true  },
  { cat: 'Integrations', label: 'Zapier / webhooks',          turingram: 'Via folder',    otter: true,  fireflies: true  },
  { cat: 'Integrations', label: 'Slack / Notion',             turingram: 'Via Claude, ChatGPT', otter: false, fireflies: true  },
  { cat: 'Integrations', label: 'Mobile app',                 turingram: false,            otter: true,  fireflies: true  },
  { cat: 'Integrations', label: 'Team collaboration',         turingram: false,            otter: true,  fireflies: true  },
]

const CATEGORIES = [...new Set(ROWS.map(r => r.cat))]

function PriceCell({ priceData }) {
  if (!priceData) return <span className="text-[13px] text-white/50 font-mono">—</span>
  if (priceData.price === null) return <span className="text-[13px] text-white/55 font-mono">see site</span>
  return (
    <span className="text-[14px] text-white/85 font-mono font-medium">
      ${priceData.price}<span className="text-[12px] text-white/55">/mo</span>
    </span>
  )
}

function Cell({ value, priceData }) {
  if (value === 'price') return <PriceCell priceData={priceData} />

  if (value === 'Planned') {
    return (
      <span className="inline-flex items-center gap-1 text-[12px] text-white/55">
        <Clock size={12} />
        Planned
      </span>
    )
  }

  if (typeof value === 'string') {
    return <span className="text-[13px] text-[#40EFAB] font-medium">{value}</span>
  }

  if (value === true) {
    return <CheckCircle size={17} weight="fill" className="text-[#40EFAB]" aria-label="Yes" />
  }

  return <Minus size={15} weight="bold" className="text-white/40" aria-label="No" />
}

export default function ComparisonTable() {
  const [open, setOpen] = useState(false)
  const [prices, setPrices] = useState(null)

  useEffect(() => {
    fetch('/prices.json')
      .then(r => r.json())
      .then(data => setPrices(data))
      .catch(() => {})
  }, [])

  // A date is only worth showing when it vouches for at least one price.
  const anyPrice = Object.values(prices?.services ?? {}).some(s => s.price !== null)
  const verifiedDate = anyPrice && prices?.lastVerified
    ? new Date(prices.lastVerified).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
    : null

  return (
    <div className="mt-12 pt-10 border-t border-white/[0.07]">
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-2 text-[13px] font-medium text-white/65 hover:text-white border border-white/15 hover:border-white/30 rounded-xl px-4 py-2 transition-all cursor-pointer"
        aria-expanded={open}
      >
        <span>Compare features</span>
        <CaretDown
          size={13}
          className={`transition-transform duration-300 ${open ? 'rotate-180' : ''}`}
        />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden"
          >
            <div className="mt-8 overflow-x-auto">
              <table className="w-full min-w-[560px] text-left border-collapse" role="table">
                <thead>
                  <tr className="border-b border-white/[0.08]">
                    <th scope="col" className="pb-3 pr-4 font-normal w-[40%]"></th>
                    <th scope="col" className="pb-3 px-4 text-[13px] font-semibold text-[#40EFAB] text-center w-[20%]">Turingram</th>
                    <th scope="col" className="pb-3 px-4 text-[13px] font-semibold text-white/65 text-center w-[20%]">Otter.ai</th>
                    <th scope="col" className="pb-3 px-4 text-[13px] font-semibold text-white/65 text-center w-[20%]">Fireflies.ai</th>
                  </tr>
                </thead>
                <tbody>
                  {CATEGORIES.map(cat => (
                    <>
                      <tr key={`cat-${cat}`}>
                        <td
                          colSpan={4}
                          className="pt-7 pb-2 text-[11px] font-mono uppercase tracking-widest text-[#40EFAB]/75"
                        >
                          {cat}
                        </td>
                      </tr>
                      {ROWS.filter(r => r.cat === cat).map(row => (
                        <tr
                          key={row.label}
                          className="border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors"
                        >
                          <td className="py-3 pr-4 text-[14px] text-white/75">{row.label}</td>
                          <td className="py-3 px-4 text-center">
                            <div className="flex justify-center">
                              <Cell value={row.turingram} />
                            </div>
                          </td>
                          <td className="py-3 px-4 text-center">
                            <div className="flex justify-center">
                              <Cell value={row.otter} priceData={prices?.services?.otter} />
                            </div>
                          </td>
                          <td className="py-3 px-4 text-center">
                            <div className="flex justify-center">
                              <Cell value={row.fireflies} priceData={prices?.services?.fireflies} />
                            </div>
                          </td>
                        </tr>
                      ))}
                    </>
                  ))}
                </tbody>
              </table>

              <p className="mt-5 text-[12px] text-white/40 leading-relaxed">
                Feature matrix maintained manually.{' '}
                {verifiedDate
                  ? `Prices last verified ${verifiedDate}.`
                  : 'See each provider’s site for current prices.'}
                {' '}Competitor features may change.
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
