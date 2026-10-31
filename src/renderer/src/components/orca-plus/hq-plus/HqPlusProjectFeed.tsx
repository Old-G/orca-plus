// Custom build (hq-project-cards): HQ+'s feed as one card per project — the projects with the owner's
// move first, then work, chats and the projects where we only wait, Unsorted last, and one dashed FYI
// row at the bottom that opens the FYI chip. A row's id stays `hqp-<card id>`, so the keys, ⌘F and
// the ticker find it as they found the old feed's rows.
import { useEffect, useRef } from 'react'
import {
  HQ_PLUS_PROJECT_FILTERS,
  type HqPlusProjectFeed as Feed,
  type HqPlusProjectFilter
} from '../../../../../shared/hq-plus-project-cards'
import { HqPlusProjectCard } from './HqPlusProjectCard'
import type { HqPlusProjectCardContext } from './HqPlusProjectParts'
import { observeHqPlusNewRows } from './use-hq-plus-new-marks'

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
  // Why: the model's order is the one shown; the marks split it only on «All».
  const firstRest = feed.cards.findIndex((card) => card.you.length === 0 || card.unsorted)
  const marks = filter === 'all' && firstRest > 0
  return (
    <div className="hqp-log hqpc-feed scrollbar-sleek" ref={scroller}>
      {feed.cards.length === 0 && (filter !== 'all' || feed.fyi.length === 0) ? (
        <p className="hqp-empty">{EMPTY[filter]}</p>
      ) : null}
      {/* Why: one keyed list, so a card moving between the groups keeps its open parts and drafts. */}
      {feed.cards.flatMap((card, index) => [
        ...(marks && index === 0
          ? [
              <div key="mark:you" className="hqpc-group">
                Your move
              </div>
            ]
          : []),
        ...(marks && index === firstRest
          ? [
              <div key="mark:rest" className="hqpc-group">
                We wait · done today
              </div>
            ]
          : []),
        <HqPlusProjectCard key={card.slug} card={card} ctx={ctx} />
      ])}
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
    </div>
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
