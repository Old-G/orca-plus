// Custom build (pulse): fires after a pulse write commits, for followers such as the HQ mirror.
import type { PulseEntity } from '../../../shared/pulse-types'

/** Custom build (p1-perf): what the write touched; `null` — unknown, so it may be anything. */
export type PulseChange = { entities: ReadonlySet<PulseEntity> | null }

type PulseChangeListener = (change: PulseChange) => void

const listeners = new Set<PulseChangeListener>()

const ANY_CHANGE: PulseChange = { entities: null }

export function onPulseChanged(listener: PulseChangeListener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Custom build (p1-perf): whether the write may have touched anything besides `ignored` —
 *  an unknown write always counts. */
export function pulseChangeBeyond(change: PulseChange, ignored: readonly PulseEntity[]): boolean {
  if (!change.entities) {
    return true
  }
  for (const entity of change.entities) {
    if (!ignored.includes(entity)) {
      return true
    }
  }
  return false
}

/** Custom build (p1-perf): whether the write may have touched `entity`. */
export function pulseChangeTouches(change: PulseChange, entity: PulseEntity): boolean {
  return !change.entities || change.entities.has(entity)
}

export function emitPulseChanged(change: PulseChange = ANY_CHANGE): void {
  for (const listener of listeners) {
    try {
      listener(change)
    } catch (error) {
      // Why: a follower's failure must never fail the write that already committed.
      console.error('[pulse] change listener failed:', error)
    }
  }
}
