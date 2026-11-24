// Custom build (hq-approve-steady): a decision's buttons take a mouse click only where the pointer saw
// them. A card that moved under a resting pointer — the feed scrolled itself, a row above it changed,
// what loaded late grew it — sent the click to whatever button slid there (owner, 24.11: he aimed at
// Approve and the message went to a ClickUp task instead of a DM). Keyboard presses are not touched.
import { useEffect, useRef, useState } from 'react'

/** A click this soon after the buttons were seen to move under the pointer is not taken. */
export const STEADY_SETTLE_MS = 700
/** A pointer away from the card that moved this recently was on its way; one idle longer looks at
 *  the card before setting off, so the place the card took meanwhile is the one it aims at. */
const TRAVEL_MS = 1500
/** A scroll this soon after a wheel or a touch is the owner's own, and what it brings is seen. Long
 *  enough for the smooth scroll a wheel tick starts to finish. */
const OWN_SCROLL_MS = 400
const HELD_MS = 4000

type Spot = { top: number; left: number }
type Seen = {
  /** The button the pointer went for (null: none of these, or one it reached as the card moved). */
  button: HTMLElement | null
  spot: Spot | null
  /** Where the card was. */
  anchor: Spot | null
  /** The pointer was over the card, its text or its buttons. */
  over: boolean
  at: number
}

function spotOf(element: Element | null | undefined): Spot | null {
  if (!element) {
    return null
  }
  const rect = element.getBoundingClientRect()
  return { top: rect.top, left: rect.left }
}

function moved(before: Spot | null, now: Spot | null): boolean {
  if (!before || !now) {
    return before !== now
  }
  return Math.abs(before.top - now.top) >= 1 || Math.abs(before.left - now.left) >= 1
}

export function useSteadyClick(): {
  /** The box holding the decision's buttons; `display: contents`, so the layout stays as it was. */
  ref: React.RefObject<HTMLDivElement | null>
  onClickCapture: (event: React.MouseEvent<HTMLElement>) => void
  /** A click was just held back; the card says so near its buttons. */
  held: boolean
} {
  const ref = useRef<HTMLDivElement>(null)
  const seen = useRef<Seen | null>(null)
  const shiftAt = useRef(Number.NEGATIVE_INFINITY)
  /** The button a click was held on because it slid under the pointer, and when. */
  const slid = useRef<{ button: HTMLElement; at: number } | null>(null)
  // Why a count: each hold shows the note for its own HELD_MS, a second hold restarts the wait.
  const [holds, setHolds] = useState(0)

  const inCard = (target: EventTarget | null): boolean =>
    target instanceof Node && ref.current !== null && ref.current.contains(target)
  const buttonAt = (target: EventTarget | null): HTMLElement | null => {
    if (!(target instanceof Element) || !inCard(target)) {
      return null
    }
    const button = target.closest('button')
    return button && inCard(button) ? button : null
  }
  const anchor = (): Spot | null => spotOf(ref.current?.querySelector('button'))
  const look = (
    button: HTMLElement | null,
    over: boolean,
    at: number,
    where: Spot | null = anchor()
  ): void => {
    seen.current = { button, spot: spotOf(button), anchor: where, over, at }
  }

  useEffect(() => {
    const doc = ref.current?.ownerDocument
    if (!doc) {
      return
    }
    // Why: a card that has just appeared has not been read; whatever is under the pointer then was
    // not aimed at.
    shiftAt.current = performance.now()
    let point: { x: number; y: number } | null = null
    let ownScrollAt = Number.NEGATIVE_INFINITY
    const onMove = (event: PointerEvent): void => {
      const now = performance.now()
      const last = seen.current
      const where = anchor()
      if (last) {
        const restedOnMoved =
          last.button !== null && last.button.isConnected && moved(last.spot, spotOf(last.button))
        // Why also after a long rest on the card: it can jump just as a reader sets off for Approve.
        const cardMoved = moved(last.anchor, where) && (last.over || now - last.at < TRAVEL_MS)
        if (restedOnMoved || cardMoved) {
          shiftAt.current = now
        }
      }
      let button = buttonAt(event.target)
      // Why: a pointer that reaches a button this soon after the card moved may have been sent for
      // the one that was there; the button counts once a move finds it after the settle time.
      if (button !== null && button !== last?.button && now - shiftAt.current < STEADY_SETTLE_MS) {
        button = null
      }
      point = { x: event.clientX, y: event.clientY }
      look(button, inCard(event.target), now, where)
    }
    const onDown = (event: PointerEvent): void => {
      // Why: a finger or a pen has no hover to aim with — it lands on what the owner sees there now.
      if (event.pointerType === 'touch' || event.pointerType === 'pen') {
        point = { x: event.clientX, y: event.clientY }
        look(buttonAt(event.target), inCard(event.target), performance.now())
      }
    }
    const onOwnInput = (): void => {
      ownScrollAt = performance.now()
    }
    const onScroll = (event: Event): void => {
      const card = ref.current
      const scroller = event.target
      // Why only a scroller holding the card: another one (a chat streaming beside the feed) moving
      // within the wheel's window says nothing about what came under the pointer here.
      const holdsCard =
        scroller === doc || (card !== null && scroller instanceof Node && scroller.contains(card))
      if (!holdsCard) {
        return
      }
      const now = performance.now()
      if (now - ownScrollAt <= OWN_SCROLL_MS && point) {
        // Why: the owner's own scroll brought this under the pointer; he sees what he scrolled to.
        const under =
          typeof doc.elementFromPoint === 'function' ? doc.elementFromPoint(point.x, point.y) : null
        look(buttonAt(under), inCard(under), now)
        return
      }
      // Why: a scroll he did not make (the Inbox centring a new Approve, the browser holding a row in
      // place) moves the card now. Timed here, a move long after it does not count it again; the
      // button the pointer rested on keeps its old place, so a move off it still sees it moved.
      const last = seen.current
      const where = anchor()
      if (last && moved(last.anchor, where)) {
        shiftAt.current = now
        seen.current = { ...last, anchor: where }
      }
    }
    const options = { capture: true, passive: true }
    doc.addEventListener('pointermove', onMove, options)
    doc.addEventListener('pointerdown', onDown, options)
    doc.addEventListener('wheel', onOwnInput, options)
    doc.addEventListener('touchmove', onOwnInput, options)
    doc.addEventListener('scroll', onScroll, options)
    return () => {
      doc.removeEventListener('pointermove', onMove, options)
      doc.removeEventListener('pointerdown', onDown, options)
      doc.removeEventListener('wheel', onOwnInput, options)
      doc.removeEventListener('touchmove', onOwnInput, options)
      doc.removeEventListener('scroll', onScroll, options)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (holds === 0) {
      return
    }
    const timer = setTimeout(() => setHolds(0), HELD_MS)
    return () => clearTimeout(timer)
  }, [holds])

  const onClickCapture = (event: React.MouseEvent<HTMLElement>): void => {
    const button = buttonAt(event.target)
    // Why: detail 0 is a key press (Enter, Space) on a focused button — nothing slid under a key.
    if (!button || event.detail === 0) {
      return
    }
    const now = performance.now()
    const last = seen.current
    // Why: a jitter back onto the button that slid in, right after the note came up, is not a read.
    const slidHere = slid.current?.button === button && now - slid.current.at < STEADY_SETTLE_MS
    const wentFor = last !== null && last.button === button && !slidHere
    const aimed =
      wentFor &&
      last !== null &&
      !moved(last.spot, spotOf(button)) &&
      now - shiftAt.current >= STEADY_SETTLE_MS
    if (aimed) {
      slid.current = null
      setHolds(0)
      return
    }
    event.preventDefault()
    event.stopPropagation()
    if (wentFor) {
      // Why: the pointer went for this very button and it shifted under it; clicking it again,
      // still where it is, is aimed — once the note has been up for the settle time, no move needed.
      look(button, true, now)
      shiftAt.current = now
    } else {
      // Why: the button under the pointer is one it did not go for, so a click on it again without a
      // move is not aimed (review 24.11: «Click again» sent the message the wrong way). A move onto
      // another button counts at once — the card is still, and the note told him to point.
      look(null, true, now)
      shiftAt.current = Number.NEGATIVE_INFINITY
      slid.current = { button, at: now }
    }
    setHolds((count) => count + 1)
  }

  return { ref, onClickCapture, held: holds > 0 }
}
