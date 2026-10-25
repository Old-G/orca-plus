// Custom build (hq-plus-side-blocks): a left-column block whose title folds it; the list scrolls
// inside the block, so the queues get the same height. Folds are remembered.
import { useState } from 'react'
import { Collapsible, CollapsibleContent } from '@/components/ui/collapsible'
import {
  readHqPlusViewState,
  saveHqPlusViewState,
  type HqPlusSideBlockId
} from './hq-plus-view-state'

export function HqPlusSideBlock({
  id,
  title,
  tone,
  startFolded = false,
  actions,
  children
}: {
  id: HqPlusSideBlockId
  title: string
  tone?: 'move'
  /** Custom build (hq-plus-round6): folded until the owner opens it (Tracked). */
  startFolded?: boolean
  /** Custom build (hq-plus-chats-by-project): buttons on the title's line, outside the fold. */
  actions?: React.ReactNode
  children: React.ReactNode
}): React.JSX.Element {
  const [open, setOpenState] = useState(() => {
    const view = readHqPlusViewState()
    return startFolded ? view.openedSides.includes(id) : !view.foldedSides.includes(id)
  })
  const setOpen = (next: boolean): void => {
    setOpenState(next)
    const view = readHqPlusViewState()
    if (startFolded) {
      const opened = view.openedSides.filter((side) => side !== id)
      saveHqPlusViewState({ openedSides: next ? [...opened, id] : opened })
      return
    }
    const folded = view.foldedSides.filter((side) => side !== id)
    saveHqPlusViewState({ foldedSides: next ? folded : [...folded, id] })
  }
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="hqp-side-sec" data-list={id} data-open={open}>
        <button
          type="button"
          className="hqp-hl hqp-side-h hqp-side-fold"
          data-tone={tone}
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          <span className="hqp-caret" data-open={open} aria-hidden="true">
            ▸
          </span>
          {title}
        </button>
        {actions ? <div className="hqp-side-acts">{actions}</div> : null}
        <CollapsibleContent animation="height">
          <div className="hqp-side-list scrollbar-sleek">{children}</div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  )
}
