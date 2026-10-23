// Custom build (hq-plus-ui-v4): what the owner clicked stays under the pointer while the list around it
// grows or folds — the scroller follows the element for as long as the height animation runs.
const PIN_MS = 260
const SCROLLERS = '.hqp-log, .hqp-side, .hqp-side-sec[data-list="waiting"]'

/** `minOffset` brings an element whose top had scrolled out of view back to the top edge. */
export function hqPlusPinWhileMoving(element: Element, minOffset: number | null = null): void {
  const scroller = element.parentElement?.closest(SCROLLERS)
  if (!scroller) {
    return
  }
  const offsetOf = (): number =>
    element.getBoundingClientRect().top - scroller.getBoundingClientRect().top
  const start = offsetOf()
  const target = minOffset === null ? start : Math.max(start, minOffset)
  const until = performance.now() + PIN_MS
  const follow = (): void => {
    if (!element.isConnected) {
      return
    }
    const drift = offsetOf() - target
    if (Math.abs(drift) >= 1) {
      scroller.scrollTop += drift
    }
    if (performance.now() < until) {
      requestAnimationFrame(follow)
    }
  }
  requestAnimationFrame(follow)
}
