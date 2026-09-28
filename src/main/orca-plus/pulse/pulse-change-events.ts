// Custom build (pulse): fires after a pulse write commits, for followers such as the HQ mirror.
type PulseChangeListener = () => void

const listeners = new Set<PulseChangeListener>()

export function onPulseChanged(listener: PulseChangeListener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function emitPulseChanged(): void {
  for (const listener of listeners) {
    try {
      listener()
    } catch (error) {
      // Why: a follower's failure must never fail the write that already committed.
      console.error('[pulse] change listener failed:', error)
    }
  }
}
