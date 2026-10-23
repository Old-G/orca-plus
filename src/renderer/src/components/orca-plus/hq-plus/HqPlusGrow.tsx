// Custom build (hq-plus-ui-v4): a box whose height follows its content smoothly, so a card that swaps
// its short view for the full one (or back) grows and folds instead of jumping. Radix's Collapsible
// covers open/closed sections; this covers content that changes in place.
import { useLayoutEffect, useRef, useState } from 'react'

export function HqPlusGrow({ children }: { children: React.ReactNode }): React.JSX.Element {
  const inner = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState<number | null>(null)
  useLayoutEffect(() => {
    const element = inner.current
    if (!element) {
      return
    }
    const observer = new ResizeObserver(() => setHeight(element.offsetHeight))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  return (
    <div className="hqp-grow" style={height === null ? undefined : { height }}>
      <div ref={inner}>{children}</div>
    </div>
  )
}
