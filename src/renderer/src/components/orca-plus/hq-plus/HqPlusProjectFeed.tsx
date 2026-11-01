// Custom build (hq-project-cards): HQ+'s feed as one card per project, read as a chat (owner, 01.11): the
// project something last came to stands at the bottom, the feed opens there and follows new arrivals
// while the owner is at the bottom; one dashed FYI row on top opens the FYI chip. A row's id stays `hqp-<card id>`, so the keys, ⌘F and
// the ticker find it as they found the old feed's rows.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  HQ_PLUS_PROJECT_FILTERS,
  type HqPlusProjectFeed as Feed,
  type HqPlusProjectFilter
} from '../../../../../shared/hq-plus-project-cards'
import { HqPlusProjectCard } from './HqPlusProjectCard'
import type { HqPlusProjectCardContext } from './HqPlusProjectParts'
import { observeHqPlusNewRows } from './use-hq-plus-new-marks'

const BOTTOM_SLACK_PX = 40

const EMPTY: Record<HqPlusProjectFilter, string> = {
  all: 'Nothing goes on in this room today.',
  move: 'Nothing waits on you.',
  wait: 'Nobody owes you anything.',
  fyi: 'Nothing went by.'
}

export function HqPlusProjectFeed({
  feed,
  filter,
  onFilter,
  ctx
}: {
  feed: Feed
  filter: HqPlusProjectFilter
  onFilter: (filter: HqPlusProjectFilter) => void
  ctx: HqPlusProjectCardContext
}): React.JSX.Element {
  const scroller = useRef<HTMLDivElement>(null)
  const { newKeys, markSeen } = ctx.log
  useEffect(() => {
    const element = scroller.current
    return element && newKeys ? observeHqPlusNewRows(element, markSeen) : undefined
  }, [newKeys, markSeen, feed])
  const atBottom = useRef(true)
  const [unseen, setUnseen] = useState<string | null>(null)
  // Why: what came last is the bottom card and its newest moment; a change of either is an arrival.
  const last = feed.cards.at(-1)
  const arrival = last ? `${last.slug}:${last.lastAt}` : ''
  const seenArrival = useRef<string | null>(null)
  useLayoutEffect(() => {
    const element = scroller.current
    if (!element || seenArrival.current === arrival) {
      return
    }
    const first = seenArrival.current === null
    seenArrival.current = arrival
    if (first || atBottom.current) {
      element.scrollTop = element.scrollHeight
    } else if (last) {
      setUnseen(last.unsorted ? 'Unsorted' : last.slug)
    }
  }, [arrival, last])
  const toBottom = (): void => {
    const element = scroller.current
    if (element) {
      element.scrollTo({ top: element.scrollHeight, behavior: 'smooth' })
    }
    atBottom.current = true
    setUnseen(null)
  }
  return (
    <>
      <div
        className="hqp-log hqpc-feed scrollbar-sleek"
        ref={scroller}
        onScroll={(event) => {
          const element = event.currentTarget
          atBottom.current =
            element.scrollHeight - element.scrollTop - element.clientHeight < BOTTOM_SLACK_PX
          if (atBottom.current) {
            setUnseen(null)
          }
        }}
      >
        {filter === 'all' && feed.fyi.length > 0 ? (
          <button type="button" className="hqpc-fyi" onClick={() => onFilter('fyi')}>
            <span className="hqpc-lab">FYI · {feed.counts.fyi}</span>
            {feed.fyi.map((row) => (
              <span key={row.slug}>
                <b>{row.slug}</b> · {row.count > 1 ? `${row.count}` : row.what}
              </span>
            ))}
          </button>
        ) : null}
        {feed.cards.length === 0 && (filter !== 'all' || feed.fyi.length === 0) ? (
          <p className="hqp-empty">{EMPTY[filter]}</p>
        ) : null}
        {/* Why: one keyed list, so a card moving down keeps its open parts and drafts. */}
        {feed.cards.map((card) => (
          <HqPlusProjectCard key={card.slug} card={card} ctx={ctx} />
        ))}
      </div>
      {unseen ? (
        <button type="button" className="hqp-jump" onClick={toBottom}>
          ↓ new in {unseen}
        </button>
      ) : null}
    </>
  )
}

const CHIP_LABEL: Record<HqPlusProjectFilter, string> = {
  all: 'All',
  move: 'Your move',
  wait: 'We wait',
  fyi: 'FYI'
}

/** All · Your move · We wait · FYI, with their counts. */
export function HqPlusProjectChips({
  filter,
  counts,
  onFilter
}: {
  filter: HqPlusProjectFilter
  counts: Feed['counts']
  onFilter: (filter: HqPlusProjectFilter) => void
}): React.JSX.Element {
  const count: Record<HqPlusProjectFilter, number | null> = {
    all: null,
    move: counts.move,
    wait: counts.wait,
    fyi: counts.fyi
  }
  return (
    <div className="hqp-chips" role="group" aria-label="Show in the feed">
      {HQ_PLUS_PROJECT_FILTERS.map((name) => (
        <button
          key={name}
          type="button"
          className="hqp-chip-btn"
          data-move={name === 'move' ? 'true' : undefined}
          aria-pressed={filter === name}
          onClick={() => onFilter(name)}
        >
          {CHIP_LABEL[name]}
          {count[name] ? <span className="hqpc-n"> {count[name]}</span> : null}
        </button>
      ))}
    </div>
  )
}
