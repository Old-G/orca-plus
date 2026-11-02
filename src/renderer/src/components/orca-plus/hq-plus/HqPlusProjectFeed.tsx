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
import { HqPlusInbox } from './HqPlusInbox'
import { hqPlusInboxQueue } from './hq-plus-inbox'

type FeedTab = 'inbox' | 'projects'
const TAB_KEY = 'orca-plus.hq-plus-feed-tab'

// Why storage may fail: a private profile or blocked storage still opens on Inbox.
function readTab(): FeedTab {
  try {
    return localStorage.getItem(TAB_KEY) === 'projects' ? 'projects' : 'inbox'
  } catch {
    return 'inbox'
  }
}

function saveTab(tab: FeedTab): void {
  try {
    localStorage.setItem(TAB_KEY, tab)
  } catch {
    // Why: the tab is a convenience; the feed works without remembering it.
  }
}

const BOTTOM_SLACK_PX = 40

const EMPTY: Record<HqPlusProjectFilter, string> = {
  all: 'Nothing goes on in this room today.',
  approve: 'Nothing waits for your Approve.',
  chats: 'No open chats here.',
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
  // Custom build (hq-plus-inbox, owner 02.11: variant B): Inbox — one queue of what to do next — and
  // Projects — the project cards, each its head line until opened.
  const [tab, setTabState] = useState<FeedTab>(readTab)
  const setTab = (next: FeedTab): void => {
    setTabState(next)
    saveTab(next)
  }
  const scroller = useRef<HTMLDivElement>(null)
  const { newKeys, markSeen } = ctx.log
  // Why the tab: each tab has its own scroller, and NEW rows lose their mark in either.
  useEffect(() => {
    const element = scroller.current
    return element && newKeys ? observeHqPlusNewRows(element, markSeen) : undefined
  }, [newKeys, markSeen, feed, tab])
  const atBottom = useRef(true)
  const [unseen, setUnseen] = useState<string | null>(null)
  // Why: what came last is the bottom card and its newest moment; a change of either is an arrival.
  const last = feed.cards.at(-1)
  const arrival = last ? `${last.slug}:${last.lastAt}` : ''
  const seenArrival = useRef<string | null>(null)
  useLayoutEffect(() => {
    const element = scroller.current
    // Why: Inbox reads from the top; only the project cards open at the bottom, as a chat.
    if (!element || tab !== 'projects' || seenArrival.current === arrival) {
      return
    }
    const first = seenArrival.current === null
    seenArrival.current = arrival
    if (first || atBottom.current) {
      element.scrollTop = element.scrollHeight
    } else if (last) {
      setUnseen(last.unsorted ? 'Unsorted' : last.slug)
    }
  }, [arrival, last, tab])
  // Custom build (hq-card-v2): every action waiting for Approve, oldest first, on a bar at the bottom
  // until it is decided (owner, 01.11: 2A).
  const approvals = feed.cards
    .flatMap((card) => card.approve.map((line) => ({ ...line, slug: card.slug })))
    .sort((a, b) => a.since - b.since)
  const goToApprove = (slug: string): void => {
    const element = scroller.current
    const target = document.getElementById(`hqpc-${slug}`)
    if (!element || !target) {
      return
    }
    const offset = target.getBoundingClientRect().top - element.getBoundingClientRect().top
    element.scrollTo({ top: element.scrollTop + offset - 12, behavior: 'smooth' })
    target.removeAttribute('data-flash')
    void target.offsetWidth
    target.setAttribute('data-flash', 'true')
  }
  const toBottom = (): void => {
    const element = scroller.current
    if (element) {
      element.scrollTo({ top: element.scrollHeight, behavior: 'smooth' })
    }
    atBottom.current = true
    setUnseen(null)
  }
  const inboxCount = (() => {
    const queue = hqPlusInboxQueue(feed)
    return queue.approve.length + queue.asks.length + queue.moves.length + queue.fyi.length
  })()
  const tabs = (
    <div className="hqpi-tabs" role="tablist" aria-label="Feed">
      <button
        type="button"
        role="tab"
        aria-selected={tab === 'inbox'}
        onClick={() => setTab('inbox')}
      >
        Inbox <span className="hqpc-n">{inboxCount}</span>
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={tab === 'projects'}
        onClick={() => setTab('projects')}
      >
        Projects{' '}
        <span className="hqpc-n">{feed.cards.filter((card) => !card.unsorted).length}</span>
      </button>
    </div>
  )
  if (tab === 'inbox') {
    return (
      <>
        {tabs}
        <HqPlusInbox
          ref={scroller}
          feed={feed}
          filter={filter}
          emptyText={filter === 'all' ? 'Nothing waits on you.' : EMPTY[filter]}
          ctx={ctx}
        />
      </>
    )
  }
  return (
    <>
      {tabs}
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
          <HqPlusProjectCard key={card.slug} card={card} ctx={ctx} folded />
        ))}
        {/* Why: sticky at the scroller's bottom, so it never covers the Ask HQ box below the feed. */}
        {approvals.length > 0 ? (
          <div className="hqpc-apbar" role="status">
            <span className="hqpc-lab">Approve · {approvals.length}</span>
            <span className="hqpc-apbar-list">
              {approvals.map((line, index) => (
                <span key={line.id}>
                  {index > 0 ? '  ·  ' : ''}
                  <b>{line.slug}</b> · {line.what}
                </span>
              ))}
            </span>
            <button type="button" onClick={() => goToApprove(approvals[0].slug)}>
              Show
            </button>
          </div>
        ) : null}
      </div>
      {unseen && approvals.length === 0 ? (
        <button type="button" className="hqp-jump" onClick={toBottom}>
          ↓ new in {unseen}
        </button>
      ) : null}
    </>
  )
}

const CHIP_LABEL: Record<HqPlusProjectFilter, string> = {
  all: 'All',
  approve: 'Approve',
  chats: 'Chats',
  move: 'Your move',
  wait: 'We wait',
  fyi: 'FYI'
}

/** All · Approve · Chats · Your move · We wait · FYI, with their counts (Chats counts the asking ones). */
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
    approve: counts.approve,
    chats: counts.asks,
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
          data-ap={name === 'approve' && counts.approve > 0 ? 'true' : undefined}
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
