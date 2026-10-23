// Custom build (hq-fix-now-all): one merge per project at a time. Fixing chats running side by side
// take the project's slot before they rebase and merge, and give it back after; a slot nobody gave
// back frees itself, so a chat that died mid-merge does not block the project.
export type HqMergeSlotTake = { ok: true } | { ok: false; holder: string; since: number }

export type HqMergeSlots = {
  take: (project: string, holder: string) => HqMergeSlotTake
  /** False when the slot is not this holder's. */
  release: (project: string, holder: string) => boolean
  status: (project: string) => { holder: string; since: number } | null
}

export function createHqMergeSlots(deps: { now: () => number; holdMs: number }): HqMergeSlots {
  const slots = new Map<string, { holder: string; since: number }>()
  const live = (project: string): { holder: string; since: number } | null => {
    const slot = slots.get(project)
    if (slot && deps.now() - slot.since > deps.holdMs) {
      slots.delete(project)
      return null
    }
    return slot ?? null
  }
  return {
    take(project, holder) {
      const slot = live(project)
      if (slot && slot.holder !== holder) {
        return { ok: false, holder: slot.holder, since: slot.since }
      }
      slots.set(project, { holder, since: slot?.since ?? deps.now() })
      return { ok: true }
    },
    release(project, holder) {
      if (live(project)?.holder !== holder) {
        return false
      }
      slots.delete(project)
      return true
    },
    status: live
  }
}

let provided: HqMergeSlots | null = null

export function provideHqMergeSlots(slots: HqMergeSlots | null): void {
  provided = slots
}

export function getHqMergeSlots(): HqMergeSlots | null {
  return provided
}
