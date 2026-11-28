// Custom build (U3, owner 28.11: 1a): the Board's feed is a window of a set share of its column, and under
// it sits «Waiting for you» — every Approve and every question to the owner, oldest first, with its own scroll.
import { useEffect, useRef, useState } from 'react'
import type { HqPlusProjectFeed as Feed } from '../../../../../shared/hq-plus-project-cards'
import { HqPlusInbox } from './HqPlusInbox'
import { hqPlusInboxQueue } from './hq-plus-inbox'
import type { HqPlusProjectCardContext } from './HqPlusProjectParts'
import { observeHqPlusNewRows } from './use-hq-plus-new-marks'
import {
  clampHqPlusFeedWindow,
  HQ_PLUS_FEED_WINDOW,
  readHqPlusFeedWindow,
  saveHqPlusFeedWindow
} from './hq-plus-panel-widths'

const KEY_STEP = 5

/** How many rows wait for the owner: Approves, chats that ask and the lines of «Your move». */
export function hqPlusDockCount(feed: Feed): number {
  const queue = hqPlusInboxQueue(feed)
  return queue.approve.length + queue.asks.length + queue.moves.length
}

/** `feed` must be built with the «All» filter: the dock does not follow the chip above the window. */
export function HqPlusBoardDock({
  feed,
  ctx
}: {
  feed: Feed
  ctx: HqPlusProjectCardContext
}): React.JSX.Element {
  const count = hqPlusDockCount(feed)
  const scroller = useRef<HTMLDivElement>(null)
  const { newKeys, markSeen } = ctx.log
  // Why: the dock's rows leave the feed's scroller, so they lose their NEW mark here.
  useEffect(() => {
    const element = scroller.current
    return element && newKeys ? observeHqPlusNewRows(element, markSeen) : undefined
  }, [newKeys, markSeen, feed])
  return (
    <section
      className="hqb-dock"
      data-empty={count === 0 ? 'true' : undefined}
      aria-label="Waiting for you"
    >
      <h4 className="hqb-dock-h">
        Waiting for you {count > 0 ? <span className="hqpc-n">{count}</span> : null}
      </h4>
      <HqPlusInbox
        ref={scroller}
        feed={feed}
        filter="all"
        part="dock"
        emptyText="Nothing waits ✓"
        ctx={ctx}
      />
    </section>
  )
}

/** The window over the dock and the grip between them; the share is kept per window (35–80%, 55 at first). */
export function HqPlusBoardSplit({
  window: top,
  dock
}: {
  window: React.ReactNode
  dock: React.ReactNode
}): React.JSX.Element {
  const [pct, setPct] = useState(readHqPlusFeedWindow)
  const box = useRef<HTMLDivElement>(null)
  const drag = useRef<{ y: number; pct: number; height: number } | null>(null)
  const set = (next: number): number => {
    const clamped = clampHqPlusFeedWindow(next)
    setPct(clamped)
    return clamped
  }
  const onPointerDown = (event: React.PointerEvent<HTMLButtonElement>): void => {
    const height = box.current?.clientHeight ?? 0
    if (height <= 0) {
      return
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { y: event.clientY, pct, height }
  }
  const onPointerMove = (event: React.PointerEvent<HTMLButtonElement>): void => {
    const start = drag.current
    if (start) {
      set(start.pct + ((event.clientY - start.y) / start.height) * 100)
    }
  }
  const onPointerUp = (): void => {
    if (drag.current) {
      drag.current = null
      saveHqPlusFeedWindow(pct)
    }
  }
  const onKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>): void => {
    const delta = event.key === 'ArrowUp' ? -KEY_STEP : event.key === 'ArrowDown' ? KEY_STEP : 0
    if (delta !== 0) {
      event.preventDefault()
      saveHqPlusFeedWindow(set(pct + delta))
    }
  }
  return (
    <div className="hqb-split" ref={box} style={{ '--hqb-win': pct } as React.CSSProperties}>
      <div className="hqb-window">{top}</div>
      <button
        type="button"
        className="hqb-grip"
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize the feed window"
        aria-valuemin={HQ_PLUS_FEED_WINDOW.min}
        aria-valuemax={HQ_PLUS_FEED_WINDOW.max}
        aria-valuenow={pct}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={onKeyDown}
      >
        <i aria-hidden="true" />
      </button>
      {dock}
    </div>
  )
}
