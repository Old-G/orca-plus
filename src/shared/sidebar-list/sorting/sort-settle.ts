import type { WorkspaceSortBy } from '../../workspace-view/workspace-row-sort'

// Why: time-decaying scores would make rows jump on every bump; coalesce a burst into one re-sort.
export const SORT_SETTLE_MS = 3_000

export type SortSettleState = {
  /** Why from the last bump (not the previous write): a row change that skipped its bump (stale-host purge) must not re-sort on its own. */
  liveCountAtLastBump: number
  /** Rows seen by the previous write, so a removal is told apart within its own write. */
  liveCountAtLastWrite: number
  /** When the pending burst settles; null when nothing is pending. */
  deadline: number | null
}

export type SortSettleEvent =
  | {
      kind: 'write'
      /** Null when the write changed neither sortEpoch nor the rows. */
      change: { epochBumped: boolean; liveCount: number } | null
      /** The write already lands settled: settling itself, or a store reset. */
      settled: boolean
      sortBy: WorkspaceSortBy
      previousSortBy: WorkspaceSortBy
    }
  | { kind: 'deadline' }

export type SortSettleStep = { state: SortSettleState; settle: boolean }

export const INITIAL_SORT_SETTLE_STATE: SortSettleState = {
  liveCountAtLastBump: 0,
  liveCountAtLastWrite: 0,
  deadline: null
}

export function reduceSortSettle(
  state: SortSettleState,
  event: SortSettleEvent,
  now: number
): SortSettleStep {
  if (event.kind === 'deadline') {
    return { state: { ...state, deadline: null }, settle: state.deadline !== null }
  }
  const { change } = event
  // Custom build (sidebar-close-stays): only an add re-ranks at once; a close or removal leaves every other row where it is.
  const removalOnly = change !== null && change.liveCount < state.liveCountAtLastWrite
  const structuralChange =
    change !== null && !removalOnly && change.liveCount !== state.liveCountAtLastBump
  const liveCountAtLastWrite = change ? change.liveCount : state.liveCountAtLastWrite
  const liveCountAtLastBump = change?.epochBumped ? change.liveCount : state.liveCountAtLastBump
  if (event.settled) {
    return { state: { liveCountAtLastBump, liveCountAtLastWrite, deadline: null }, settle: false }
  }
  // Why: adds/removes, Manual (direct manipulation), and a mode switch never wait out the window.
  if (structuralChange || event.sortBy === 'manual' || event.sortBy !== event.previousSortBy) {
    return { state: { liveCountAtLastBump, liveCountAtLastWrite, deadline: null }, settle: true }
  }
  // A removal bump arms no re-rank: the rows that stay keep their order and the owner's scroll position.
  const deadline = change?.epochBumped && !removalOnly ? now + SORT_SETTLE_MS : state.deadline
  return { state: { liveCountAtLastBump, liveCountAtLastWrite, deadline }, settle: false }
}
