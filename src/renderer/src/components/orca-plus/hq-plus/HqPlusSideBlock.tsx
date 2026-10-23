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
  children
}: {
  id: HqPlusSideBlockId
  title: string
  tone?: 'move'
  children: React.ReactNode
}): React.JSX.Element {
  const [open, setOpenState] = useState(() => !readHqPlusViewState().foldedSides.includes(id))
  const setOpen = (next: boolean): void => {
    setOpenState(next)
    const folded = readHqPlusViewState().foldedSides.filter((side) => side !== id)
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
            {'▸'}
          </span>
          {title}
        </button>
        <CollapsibleContent animation="height">
          <div className="hqp-side-list scrollbar-sleek">{children}</div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  )
}
