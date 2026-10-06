import { Link } from 'react-router'
import { ArrowLeft } from '@phosphor-icons/react'

export function GuideNav() {
  return (
    <nav className="sticky top-0 z-50 flex items-center justify-between px-6 md:px-12 h-14 bg-[#020210]/95 backdrop-blur-md border-b border-white/5">
      <Link
        to="/"
        className="flex items-center gap-2 text-[13px] text-white/65 hover:text-white/75 transition-colors"
      >
        <ArrowLeft size={14} />
        Back to Turingram
      </Link>
      <a
        href="https://github.com/jared-the-automator/turingram/releases/latest"
        className="text-[12px] font-bold px-4 py-1.5 rounded-full bg-[#40EFAB] text-[#020210] hover:bg-[#2cd492] transition-colors"
      >
        Download Turingram
      </a>
    </nav>
  )
}

export function GuideFooterCTA() {
  return (
    <div className="mt-20 py-16 border-t border-white/8 text-center">
      <p className="text-[17px] text-white/55 mb-6 max-w-[42ch] mx-auto leading-relaxed">
        Record your first meeting, export the transcript, and run any prompt on this page. That's all there is to it.
      </p>
      <a
        href="https://github.com/jared-the-automator/turingram/releases/latest"
        className="inline-flex items-center px-7 py-3.5 rounded-full bg-[#40EFAB] text-[#020210] font-bold text-[15px] hover:bg-[#2cd492] transition-colors"
      >
        Download Turingram
      </a>
    </div>
  )
}

export function Step({ n, title, children }) {
  return (
    <div className="flex gap-5 py-7 border-b border-white/[0.06]">
      <div className="shrink-0 mt-0.5 w-7 h-7 rounded-full bg-[#40EFAB]/12 flex items-center justify-center">
        <span className="text-[11px] font-bold text-[#40EFAB] font-mono">{n}</span>
      </div>
      <div className="flex-1 min-w-0">
        {title && <h3 className="font-semibold text-[15px] mb-2 text-white">{title}</h3>}
        <div className="text-[15px] text-white/55 leading-relaxed space-y-4">
          {children}
        </div>
      </div>
    </div>
  )
}

export function SectionHeading({ id, children }) {
  return (
    <h2 id={id} className="text-2xl font-bold tracking-tight mt-16 mb-2 scroll-mt-20">
      {children}
    </h2>
  )
}

export function SectionSubhead({ children }) {
  return (
    <p className="text-[15px] text-white/65 mb-8 leading-relaxed">{children}</p>
  )
}

export function Callout({ children }) {
  return (
    <div className="rounded-xl border border-[#40EFAB]/15 bg-[#40EFAB]/5 p-4 text-[14px] text-white/65 leading-relaxed">
      {children}
    </div>
  )
}

export function TOC({ items }) {
  return (
    <nav className="hidden lg:block sticky top-20 self-start">
      <p className="text-[11px] text-white/60 font-mono uppercase tracking-widest mb-4">Contents</p>
      <ul className="space-y-2">
        {items.map(item => (
          <li key={item.id}>
            <a
              href={`#${item.id}`}
              className="text-[13px] text-white/60 hover:text-white/70 transition-colors leading-snug block"
            >
              {item.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  )
}
