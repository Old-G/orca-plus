// Custom build (hq-plus-ui-v4): ⌘F over HQ+'s feed — the words light up where they are shown, Enter and
// ⇧Enter step through the matching cards, Esc clears. It searches inside the chips' current view.
import { useEffect } from 'react'
import { translate } from '@/i18n/i18n'
import { isImeOwnedKeyboardEvent } from '@/lib/ime-composition-keyboard-event'

const HIGHLIGHT = 'hqp-search'

function highlightIn(root: Element, query: string): void {
  const needle = query.trim().toLocaleLowerCase()
  if (!needle) {
    CSS.highlights.delete(HIGHLIGHT)
    return
  }
  const ranges: Range[] = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.textContent?.toLocaleLowerCase() ?? ''
    for (let at = text.indexOf(needle); at !== -1; at = text.indexOf(needle, at + needle.length)) {
      const range = new Range()
      range.setStart(node, at)
      range.setEnd(node, at + needle.length)
      ranges.push(range)
    }
  }
  CSS.highlights.set(HIGHLIGHT, new Highlight(...ranges))
}

/** Keeps the words lit while cards fold, grow and arrive. */
function useFeedHighlight(query: string): void {
  useEffect(() => {
    const log = document.querySelector('.hq-plus .hqp-log')
    if (!log || !query.trim()) {
      CSS.highlights.delete(HIGHLIGHT)
      return
    }
    let frame = 0
    const paint = (): void => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const current = document.querySelector('.hq-plus .hqp-log')
        if (current) {
          highlightIn(current, query)
        }
      })
    }
    paint()
    // Why: the log is re-created when the chips change; watch its parent so the new one is painted too.
    const observer = new MutationObserver(paint)
    observer.observe(log.parentElement ?? log, {
      childList: true,
      subtree: true,
      characterData: true
    })
    return () => {
      observer.disconnect()
      cancelAnimationFrame(frame)
      CSS.highlights.delete(HIGHLIGHT)
    }
  }, [query])
}

export function HqPlusFeedSearch({
  query,
  matches,
  at,
  inputRef,
  onQuery,
  onStep,
  onClose
}: {
  query: string
  matches: number
  /** The match on view, from 0; -1 before the first step. */
  at: number
  inputRef: React.RefObject<HTMLInputElement | null>
  onQuery: (query: string) => void
  onStep: (direction: 1 | -1) => void
  onClose: () => void
}): React.JSX.Element {
  useFeedHighlight(query)
  return (
    <div className="hqp-search" role="search">
      <input
        ref={inputRef}
        type="search"
        className="hqp-search-in"
        value={query}
        placeholder={translate('auto.hqPlus.search.placeholder', 'Search the feed')}
        aria-label={translate('auto.hqPlus.search.label', 'Search the feed')}
        onChange={(event) => onQuery(event.target.value)}
        onKeyDown={(event) => {
          if (isImeOwnedKeyboardEvent(event.nativeEvent)) {
            return
          }
          if (event.key === 'Enter') {
            event.preventDefault()
            onStep(event.shiftKey ? -1 : 1)
          } else if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            onClose()
          }
        }}
      />
      <span className="hqp-search-n" aria-live="polite">
        {query.trim()
          ? translate('auto.hqPlus.search.count', '{{at}} of {{count}}', {
              at: matches === 0 ? 0 : Math.max(at, 0) + 1,
              count: matches
            })
          : ''}
      </span>
      <button
        type="button"
        className="hqp-link"
        disabled={matches === 0}
        aria-label={translate('auto.hqPlus.search.prev', 'Previous match')}
        onClick={() => onStep(-1)}
      >
        ↑
      </button>
      <button
        type="button"
        className="hqp-link"
        disabled={matches === 0}
        aria-label={translate('auto.hqPlus.search.next', 'Next match')}
        onClick={() => onStep(1)}
      >
        ↓
      </button>
      <button
        type="button"
        className="hqp-x"
        aria-label={translate('auto.hqPlus.search.close', 'Close search')}
        onClick={onClose}
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          aria-hidden="true"
        >
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    </div>
  )
}
