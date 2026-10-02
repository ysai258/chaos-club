/**
 * The expert's manual pages: tabbed, searchable, big type for a 360px phone.
 * Only renders sections the server put in this viewer's view.
 */
import { useMemo, useState, type ReactNode } from 'react'
import type { ManualBlock, ManualSection } from '../../../games/bomb-squad/shared.ts'
import { Badge, cn, haptic } from '../../ui/index.ts'
import { Glyph } from './glyphs.tsx'
import { MODULE_EMOJI } from './util.ts'

const norm = (s: string) => s.toUpperCase().replace(/[’‘]/g, "'").trim()

function Mark({ text, q }: { text: string; q: string }): ReactNode {
  if (!q) return text
  const i = norm(text).indexOf(q)
  if (i < 0) return text
  return (
    <>
      {text.slice(0, i)}
      <mark className="rounded bg-sun px-0.5 text-ink">{text.slice(i, i + q.length)}</mark>
      {text.slice(i + q.length)}
    </>
  )
}

function Block({ b, q }: { b: ManualBlock; q: string }) {
  switch (b.t) {
    case 'p':
      return q ? null : <p className="rounded-xl bg-paper-deep px-3 py-2 text-[15px] leading-snug text-ink-soft">{b.text}</p>
    case 'rules': {
      const items = b.items.map((text, i) => ({ text, i })).filter((x) => !q || norm(x.text).includes(q) || norm(b.heading ?? '').includes(q))
      if (!items.length) return null
      return (
        <div>
          {b.heading && <h4 className="mb-2 font-display text-xl font-extrabold"><Mark text={b.heading} q={q} /></h4>}
          <ol className="flex flex-col gap-2">
            {items.map(({ text, i }) => (
              <li key={i} className="flex gap-2.5 rounded-xl border-2 border-ink bg-white px-3 py-2.5 text-[17px] leading-snug">
                <span className="grid size-7 shrink-0 place-items-center rounded-full border-2 border-ink bg-sun font-display text-sm font-black">{i + 1}</span>
                <span><Mark text={text} q={q} /></span>
              </li>
            ))}
          </ol>
        </div>
      )
    }
    case 'table': {
      let rows = b.rows.filter((r) => !q || r.some((c) => norm(c).includes(q)))
      if (q) rows = [...rows].sort((x, y) => Number(norm(y[0]!) === q) - Number(norm(x[0]!) === q))
      if (!rows.length) return null
      return (
        <div>
          {b.heading && <h4 className="mb-2 font-display text-xl font-extrabold">{b.heading}</h4>}
          <div className="flex flex-col gap-2">
            {rows.map((r) => (
              <div key={r[0]} className={cn('rounded-xl border-2 border-ink bg-white px-3 py-2', q && norm(r[0]!) === q && 'ring-4 ring-sun')}>
                <div className="font-chunky text-lg leading-tight break-words"><Mark text={r[0]!} q={q} /></div>
                {r.slice(1).map((cell, ci) => (
                  <div key={ci} className="mt-1 text-[16px] leading-snug">
                    {b.head.length > 2 && <span className="mr-1 font-display text-xs font-bold uppercase text-ink-soft">{b.head[ci + 1]}</span>}
                    <span className="font-display font-bold"><Mark text={cell} q={q} /></span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      )
    }
    case 'glyphcols':
      if (q) return null
      return (
        <div className="grid grid-cols-2 gap-3">
          {b.cols.map((c) => (
            <div key={c.label} className="rounded-2xl border-3 border-ink bg-white p-2">
              <div className="mb-1 text-center font-display text-base font-extrabold">{c.label}</div>
              <ol className="flex flex-col items-center gap-1">
                {c.glyphs.map((g, i) => (
                  <li key={i} className="flex w-full items-center gap-2 border-b border-ink/10 last:border-0">
                    <span className="w-5 text-right font-display text-xs font-bold text-ink-soft">{i + 1}</span>
                    <Glyph id={g} size={48} />
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </div>
      )
    case 'words': {
      const words = b.words.filter((w) => !q || norm(w).includes(q))
      if (!words.length) return null
      return (
        <div className="grid grid-cols-3 gap-2">
          {words.map((w) => (
            <span key={w} className="rounded-xl border-2 border-ink bg-white py-2 text-center font-chunky text-base"><Mark text={w} q={q} /></span>
          ))}
        </div>
      )
    }
  }
}

function matches(b: ManualBlock, q: string): boolean {
  switch (b.t) {
    case 'p': case 'glyphcols': return false
    case 'rules': return norm(b.heading ?? '').includes(q) || b.items.some((x) => norm(x).includes(q))
    case 'table': return b.rows.some((r) => r.some((c) => norm(c).includes(q)))
    case 'words': return b.words.some((w) => norm(w).includes(q))
  }
}

function SectionBody({ s, q }: { s: ManualSection; q: string }) {
  return (
    <div className="flex flex-col gap-3">
      {s.blocks.map((b, i) => <Block key={i} b={b} q={q} />)}
    </div>
  )
}

export function Manual({ sections, compact }: { sections: ManualSection[]; compact?: boolean }) {
  const [tab, setTab] = useState(0)
  const [query, setQuery] = useState('')
  const q = norm(query)
  const current = sections[Math.min(tab, sections.length - 1)]
  const searchable = useMemo(() => sections.some((s) => s.blocks.some((b) => b.t !== 'glyphcols' && b.t !== 'p')), [sections])

  if (!sections.length) {
    return <p className="rounded-2xl border-3 border-dashed border-ink/40 p-4 text-center font-display font-bold text-ink-soft">No pages for you this bomb.</p>
  }

  return (
    <section aria-label="Your manual pages" className="flex flex-col gap-3" data-testid="manual">
      {!compact && (
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-2xl">📖 Your pages</h3>
          <Badge color="ink">{sections.length} page{sections.length === 1 ? '' : 's'}</Badge>
        </div>
      )}
      {searchable && (
        <label className="relative block">
          <span className="sr-only">Search your pages</span>
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-lg" aria-hidden>🔎</span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search: THEIR, MANGO, white…"
            className="h-12 w-full rounded-2xl border-3 border-ink bg-white pl-10 pr-10 font-display font-bold uppercase placeholder:normal-case placeholder:font-normal placeholder:text-ink-soft focus:outline-none focus:ring-4 focus:ring-sky"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            data-testid="manual-search"
          />
          {query && (
            <button type="button" aria-label="Clear search" onClick={() => setQuery('')} className="absolute right-0.5 top-1/2 grid size-11 -translate-y-1/2 place-items-center rounded-xl text-xl">✕</button>
          )}
        </label>
      )}
      {!q && sections.length > 1 && (
        <div className="flex flex-wrap gap-2" role="tablist">
          {sections.map((s, i) => (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={i === tab}
              onClick={() => { haptic('tap'); setTab(i) }}
              className={cn(
                'min-h-11 rounded-2xl border-3 border-ink px-3 py-1.5 text-left font-display text-sm font-extrabold leading-tight',
                i === tab ? 'bg-ink text-paper' : 'bg-white shadow-hard-sm',
              )}
            >
              {MODULE_EMOJI[s.kind]} {s.module}
              {s.title !== 'Full page' && <span className="block text-xs font-bold opacity-75">{s.title}</span>}
            </button>
          ))}
        </div>
      )}
      {q ? (
        <div className="flex flex-col gap-4">
          {!sections.some((s) => s.blocks.some((b) => matches(b, q))) && (
            <p className="rounded-2xl border-3 border-dashed border-ink/40 p-4 text-center font-display font-bold text-ink-soft">Nothing on your pages matches “{query}”. Maybe a teammate has it?</p>
          )}
          {sections.filter((s) => s.blocks.some((b) => matches(b, q))).map((s) => (
            <div key={s.id} className="flex flex-col gap-2">
              <div className="font-display text-sm font-bold text-ink-soft">{MODULE_EMOJI[s.kind]} {s.module} · {s.title}</div>
              <SectionBody s={s} q={q} />
            </div>
          ))}
        </div>
      ) : current ? (
        <article className="rounded-3xl border-3 border-ink bg-paper p-3 shadow-hard" role="tabpanel">
          <header className="mb-3 flex flex-wrap items-start justify-between gap-2">
            <div>
              <div className="font-display text-xs font-bold uppercase tracking-wider text-ink-soft">Defusal manual · {current.title}</div>
              <h4 className="text-2xl leading-tight">{MODULE_EMOJI[current.kind]} {current.module}</h4>
            </div>
            {current.copy && <Badge color="sky">backup copy</Badge>}
            {current.borrowedFrom && <Badge color="sun">from {current.borrowedFrom}</Badge>}
          </header>
          <SectionBody s={current} q="" />
        </article>
      ) : null}
    </section>
  )
}
