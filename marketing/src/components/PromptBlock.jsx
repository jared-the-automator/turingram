import { useState } from 'react'
import { Copy } from '@phosphor-icons/react'

export default function PromptBlock({ label, code }) {
  const [copied, setCopied] = useState(false)
  const handleCopy = () => {
    navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }
  return (
    <div className="rounded-xl border border-white/[0.07] bg-[#020210] overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/[0.07]">
        <span className="text-[11px] text-white/60 font-mono">{label}</span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1.5 text-[11px] text-white/60 hover:text-[#40EFAB] transition-colors cursor-pointer"
        >
          <Copy size={12} />
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="p-4 text-[12px] font-mono text-[#40EFAB]/70 leading-relaxed whitespace-pre-wrap overflow-x-auto">
        {code}
      </pre>
    </div>
  )
}
