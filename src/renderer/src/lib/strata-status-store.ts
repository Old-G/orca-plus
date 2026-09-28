// Custom build (strata-status): per-project Strata status, filled by useStrataStatusRefresh.
import { useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'
import type { StrataStatus } from '../../../shared/strata-status'

const strataStatusStore = createStore<Readonly<Record<string, StrataStatus>>>(() => ({}))
let latestRequest = 0

export function useStrataStatus(repoId: string): StrataStatus | undefined {
  return useStore(strataStatusStore, (statuses) => statuses[repoId])
}

export async function refreshStrataStatuses(repoIds: readonly string[]): Promise<void> {
  const request = ++latestRequest
  const statuses = await window.api.strata.status([...repoIds])
  // Why: a slow SSH answer must not overwrite a newer refresh that already landed.
  if (request === latestRequest) {
    strataStatusStore.setState(statuses, true)
  }
}
