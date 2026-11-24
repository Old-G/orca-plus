// Custom build (hq-approve-steady): a decision's buttons take a mouse click only where the pointer saw
// them. A card that moved under a resting pointer — the feed scrolled itself, a row above it changed,
// what loaded late grew it — sent the click to whatever button slid there (owner, 24.11: he aimed at
// Approve and the message went to a ClickUp task instead of a DM). Keyboard presses are not touched.
import { useEffect, useRef, useState } from 'react'

/** A click this soon after the buttons were seen to move under the pointer is not taken. */
export const STEADY_SETTLE_MS = 700
/** A pointer that moved this recently was on its way; the card moving then may have redirected it. */
const TRAVEL_MS = 1500
/** A scroll this soon after a wheel or a touch is the owner's own, and what it brings is seen. Long
 *  enough for the smooth scroll a wheel tick starts to finish. */
const OWN_SCROLL_MS = 400
const HELD_MS = 4000

type Spot = { top: number; left: number }
type Seen = { button: HTMLElement | null; spot: Spot | null; anchor: Spot | null; at: number }

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
  /** A click was just held back; the card says so under its buttons. */
  held: boolean
} {
  const ref = useRef<HTMLDivElement>(null)
  const seen = useRef<Seen | null>(null)
  const shiftAt = useRef(Number.NEGATIVE_INFINITY)
  const [held, setHeld] = useState(false)

  const buttonAt = (target: EventTarget | null): HTMLElement | null => {
    const root = ref.current
    if (!root || !(target instanceof Element)) {
      return null
    }
    const button = target.closest('button')
    return button && root.contains(button) ? button : null
  }
  const anchor = (): Spot | null => spotOf(ref.current?.querySelector('button'))
  const look = (button: HTMLElement | null, at: number, where: Spot | null = anchor()): void => {
    seen.current = { button, spot: spotOf(button), anchor: where, at }
  }

  useEffect(() => {
    const doc = ref.current?.ownerDocument
    if (!doc) {
      return
    }
    let point: { x: number; y: number } | null = null
    let ownScrollAt = Number.NEGATIVE_INFINITY
    const onMove = (event: PointerEvent): void => {
      const now = performance.now()
      const last = seen.current
      const where = anchor()
      // Why every move, wherever it lands: the card can jump while the pointer crosses its text on
      // the way to Approve, and the next move would take the new place as the one it saw.
      if (last) {
        const restedOnMoved =
          last.button !== null && last.button.isConnected && moved(last.spot, spotOf(last.button))
        const travelledOnMoved = now - last.at < TRAVEL_MS && moved(last.anchor, where)
        if (restedOnMoved || travelledOnMoved) {
          shiftAt.current = now
        }
      }
      point = { x: event.clientX, y: event.clientY }
      look(buttonAt(event.target), now, where)
    }
    const onDown = (event: PointerEvent): void => {
      // Why: a finger or a pen has no hover to aim with — it lands on what the owner sees there now.
      if (event.pointerType === 'touch' || event.pointerType === 'pen') {
        point = { x: event.clientX, y: event.clientY }
        look(buttonAt(event.target), performance.now())
      }
    }
    const onOwnInput = (): void => {
      ownScrollAt = performance.now()
    }
    const onScroll = (): void => {
      const now = performance.now()
      if (now - ownScrollAt > OWN_SCROLL_MS || !point) {
        return
      }
      // Why: the owner's own scroll brought this under the pointer; he sees what he scrolled to.
      const under =
        typeof doc.elementFromPoint === 'function' ? doc.elementFromPoint(point.x, point.y) : null
      look(buttonAt(under), now)
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
    if (!held) {
      return
    }
    const timer = setTimeout(() => setHeld(false), HELD_MS)
    return () => clearTimeout(timer)
  }, [held])

  const onClickCapture = (event: React.MouseEvent<HTMLElement>): void => {
    const button = buttonAt(event.target)
    // Why: detail 0 is a key press (Enter, Space) on a focused button — nothing slid under a key.
    if (!button || event.detail === 0) {
      return
    }
    const now = performance.now()
    const last = seen.current
    const aimed =
      last !== null &&
      last.button === button &&
      !moved(last.spot, spotOf(button)) &&
      now - shiftAt.current >= STEADY_SETTLE_MS
    if (aimed) {
      setHeld(false)
      return
    }
    event.preventDefault()
    event.stopPropagation()
    // Why: the note tells him what is under the pointer now, so «Click again» on the same button,
    // still where it is, is aimed — once the note has been up for the settle time, without a move.
    look(button, now)
    shiftAt.current = now
    setHeld(true)
  }

  return { ref, onClickCapture, held }
}
