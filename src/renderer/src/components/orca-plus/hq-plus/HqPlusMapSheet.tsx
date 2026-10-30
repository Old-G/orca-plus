// Custom build (hq-plus-map): the panel over the map (owner, 31.10). Docked to the right edge it is as
// tall as the map; its left edge drags it wider or narrower. The grip on top drags it anywhere over the
// map, where its bottom edge sets the height too; a double-click on the grip docks it back. Folded, it
// is a small button at the top right.
import { useRef, useState } from 'react'
import type { HqPlusMapDockPlace } from './hq-plus-map-view'

const MIN_W = 320
const MIN_H = 240
const MARGIN = 10

type Drag = {
  kind: 'move' | 'width' | 'height'
  x: number
  y: number
  start: { x: number; y: number; width: number; height: number }
  bounds: { width: number; height: number }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

export function HqPlusMapSheet({
  place,
  folded,
  foldedLabel,
  onPlace,
  onFold,
  children
}: {
  place: HqPlusMapDockPlace
  folded: boolean
  /** What the folded button says: the tab or chat the panel holds. */
  foldedLabel: string
  onPlace: (place: HqPlusMapDockPlace) => void
  onFold: (folded: boolean) => void
  children: React.ReactNode
}): React.JSX.Element {
  const sheet = useRef<HTMLElement>(null)
  const [live, setLive] = useState<HqPlusMapDockPlace | null>(null)
  const shown = live ?? place

  const begin = (kind: Drag['kind']) => (event: React.PointerEvent) => {
    const node = sheet.current
    const stage = node?.parentElement
    if (!node || !stage || event.button !== 0) {
      return
    }
    event.preventDefault()
    const box = node.getBoundingClientRect()
    const area = stage.getBoundingClientRect()
    const drag: Drag = {
      kind,
      x: event.clientX,
      y: event.clientY,
      start: {
        x: box.left - area.left,
        y: box.top - area.top,
        width: box.width,
        height: box.height
      },
      bounds: { width: area.width, height: area.height }
    }
    let latest = shown
    let moved = false
    const onMove = (move: PointerEvent): void => {
      const dx = move.clientX - drag.x
      const dy = move.clientY - drag.y
      // Why: a click on the grip or an edge is not a drag; the panel stays where it is.
      if (!moved && Math.abs(dx) + Math.abs(dy) < 4) {
        return
      }
      moved = true
      const { start, bounds } = drag
      if (drag.kind === 'move') {
        latest = {
          width: start.width,
          float: {
            x: clamp(start.x + dx, 0, bounds.width - 120),
            y: clamp(start.y + dy, 0, bounds.height - 60),
            height: start.height
          }
        }
      } else if (drag.kind === 'width') {
        const width = clamp(start.width - dx, MIN_W, bounds.width - 2 * MARGIN)
        latest = {
          width,
          float: latest.float ? { ...latest.float, x: start.x + start.width - width } : null
        }
      } else if (latest.float) {
        latest = {
          ...latest,
          float: {
            ...latest.float,
            height: clamp(start.height + dy, MIN_H, bounds.height - latest.float.y)
          }
        }
      }
      setLive(latest)
    }
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      setLive(null)
      if (moved) {
        onPlace(latest)
      }
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  if (folded) {
    return (
      <button
        type="button"
        className="hqm-unfold"
        title="Show the panel"
        onClick={() => onFold(false)}
      >
        ‹ {foldedLabel}
      </button>
    )
  }
  const float = shown.float
  return (
    <aside
      ref={sheet}
      className="hqm-sheet"
      data-float={float ? 'true' : undefined}
      data-dragging={live ? 'true' : undefined}
      style={
        float
          ? { left: float.x, top: float.y, width: shown.width, height: float.height }
          : { width: shown.width }
      }
      aria-label="Card, chat and panels"
    >
      <div
        className="hqm-grip"
        title="Drag to move · double-click to dock"
        onPointerDown={begin('move')}
        onDoubleClick={() => onPlace({ width: shown.width, float: null })}
      >
        <span className="hqm-grip-bar" aria-hidden="true" />
        <button
          type="button"
          className="hqm-fold"
          aria-label="Fold the panel"
          title="Fold the panel"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => onFold(true)}
        >
          ›
        </button>
      </div>
      <div className="hqm-edge-w" onPointerDown={begin('width')} aria-hidden="true" />
      {float ? (
        <div className="hqm-edge-h" onPointerDown={begin('height')} aria-hidden="true" />
      ) : null}
      {children}
    </aside>
  )
}
