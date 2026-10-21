// Custom build (toast-stack-height): sonner measures a custom toast only when its jsx changes, and
// measures it scaled down when it sits behind another, so a card that grew after it popped (chat
// lists loading, a long answer) or was redrawn in the back of the stack slid over its neighbours.
import { useLayoutEffect, useRef, type ReactNode } from 'react'
import { toast, type ExternalToast } from 'sonner'

function MeasuredToast({
  onStale,
  children
}: {
  onStale: () => void
  children: ReactNode
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const stale = useRef(onStale)
  stale.current = onStale
  useLayoutEffect(() => {
    const node = ref.current
    const item = node?.closest<HTMLElement>('[data-sonner-toast]')
    if (!node || !item) {
      return
    }
    let asked = ''
    let timer: ReturnType<typeof setTimeout> | undefined
    const check = (): void => {
      // Why only then: sonner measures a back card scaled down, which would never match.
      const unscaled = item.dataset.expanded === 'true' || item.dataset.front === 'true'
      const want = node.offsetHeight
      const have = Number.parseFloat(item.style.getPropertyValue('--initial-height'))
      const ask = `${want}:${have}`
      if (unscaled && Number.isFinite(have) && Math.abs(want - have) > 1 && ask !== asked) {
        asked = ask
        stale.current()
      }
    }
    // Why the wait: sonner measures with getBoundingClientRect, so mid-transition (400ms) it
    // still sees the card scaled.
    const later = (): void => {
      clearTimeout(timer)
      timer = setTimeout(check, 450)
    }
    const resizes = new ResizeObserver(later)
    resizes.observe(node)
    const moves = new MutationObserver(later)
    moves.observe(item, { attributes: true, attributeFilter: ['data-expanded', 'data-front'] })
    return () => {
      clearTimeout(timer)
      resizes.disconnect()
      moves.disconnect()
    }
  }, [])
  return <div ref={ref}>{children}</div>
}

/** `toast.custom` whose place in the stack follows the card's real height. */
export function showMeasuredCustomToast(
  render: () => ReactNode,
  options: ExternalToast & { id: string }
): void {
  let gone = false
  const opts: ExternalToast = {
    ...options,
    onDismiss: (shown) => {
      gone = true
      options.onDismiss?.(shown)
    }
  }
  // Why re-issue: the same id with new jsx is what makes sonner measure the card again.
  const show = (): void => {
    if (!gone) {
      toast.custom(() => <MeasuredToast onStale={show}>{render()}</MeasuredToast>, opts)
    }
  }
  show()
}
