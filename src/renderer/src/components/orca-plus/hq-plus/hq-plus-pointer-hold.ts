// Custom build (hq-approve-steady): the feed scrolls itself only while the pointer is elsewhere. A scroll
// under a pointer aiming at a button brings another button under it (owner, 24.11: the card jumped up
// as he went for Approve, and the click went to the button that slid there).

/** True while the pointer is over the scroller (or anything inside it). */
export function hqPlusPointerOver(scroller: Element): boolean {
  try {
    return scroller.matches(':hover')
  } catch {
    return false
  }
}

/** Runs `move` now, or once the pointer leaves the scroller; the returned function cancels a wait. */
export function hqPlusMoveWhenPointerAway(scroller: Element, move: () => void): () => void {
  if (!hqPlusPointerOver(scroller)) {
    move()
    return () => {}
  }
  const leave = (): void => {
    scroller.removeEventListener('pointerleave', leave)
    move()
  }
  scroller.addEventListener('pointerleave', leave)
  return () => scroller.removeEventListener('pointerleave', leave)
}
