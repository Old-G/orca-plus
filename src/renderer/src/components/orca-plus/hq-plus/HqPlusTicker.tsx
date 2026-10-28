// Custom build (hq-plus-ticker): the left column's live strip — what comes in and what every chat does,
// newest at the bottom, sliding up like a live stream's chat. It took the place of «Waiting on you» and
// «We wait for», which moved into the feed's chips (owner, 28.10).
import { useEffect, useMemo, useRef } from 'react'
import { translate } from '@/i18n/i18n'
import type { HqPlusLogItem } from '../../../../../shared/hq-plus-log'
import { hqPlusTickerMark } from './hq-plus-ticker-mark'

const SHOWN = 40

function textOf(item: HqPlusLogItem): string {
  const raw = item.kind === 'me' ? `→ ${item.text}` : item.title
  return raw.replace(/\*\*/g, '').replace(/\s+/g, ' ').trim()
}

function timeOf(at: number): string {
  return new Date(at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

export function HqPlusTicker({
  items,
  onGo
}: {
  items: readonly HqPlusLogItem[]
  onGo: (item: HqPlusLogItem) => void
}): React.JSX.Element {
  const shown = useMemo(() => [...items].sort((a, b) => a.at - b.at).slice(-SHOWN), [items])
  const listRef = useRef<HTMLOListElement>(null)
  const newest = shown.at(-1)?.id ?? null
  // Why: like a live chat, the strip follows the newest line unless the owner scrolled back to read.
  // A smooth scroll fired scroll events halfway down that read as the owner scrolling away, and the
  // strip stopped following; it now jumps, and the new line's slide-in carries the motion.
  const pinned = useRef(true)
  useEffect(() => {
    const list = listRef.current
    if (list && pinned.current) {
      list.scrollTop = list.scrollHeight
    }
  }, [newest])
  return (
    <section
      className="hqp-ticker"
      aria-label={translate('auto.hqPlus.ticker.label', 'Live: what comes in and what chats do')}
    >
      <div className="hqp-ticker-h">
        <span className="hqp-ticker-dot" aria-hidden="true" />
        {translate('auto.hqPlus.ticker.title', 'Live')}
      </div>
      <ol
        ref={listRef}
        className="hqp-ticker-list"
        onScroll={(event) => {
          const list = event.currentTarget
          pinned.current = list.scrollHeight - list.scrollTop - list.clientHeight < 24
        }}
      >
        {shown.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              onClick={() => onGo(item)}
              title={textOf(item)}
              data-asks={item.kind === 'card' && item.open ? 'true' : undefined}
            >
              <span className="mk" aria-hidden="true">
                {hqPlusTickerMark(item)}
              </span>
              <span className="tm">{timeOf(item.at)}</span>
              {item.project ? <span className="pj">{item.project}</span> : null}
              <span className="tx">{textOf(item)}</span>
            </button>
          </li>
        ))}
      </ol>
    </section>
  )
}
