// Custom build (hq-plus-brain): a task id, an MR, a person or a project clicked anywhere in HQ+ opens the
// «Brain» screen on it. HQ+ registers while mounted; a click with HQ+ gone does nothing.
type BrainListener = (query: string) => void

let listener: BrainListener | null = null

export function registerHqPlusBrain(next: BrainListener): () => void {
  listener = next
  return () => {
    if (listener === next) {
      listener = null
    }
  }
}

/** Opens Brain on `query` (empty: on the search box); false when HQ+ is not on screen. */
export function openHqPlusBrain(query: string): boolean {
  if (!listener) {
    return false
  }
  listener(query.trim())
  return true
}
