// Custom build (sidebar-summary): agent counts per project for the sidebar's project headers, one
// pass for every header — the per-workspace tallies the sidebar's own counts already keep, summed
// by project.
import type { DashboardBucket } from '../../../../shared/dashboard-snapshot'
import { useAppStore } from '@/store'
import {
  buildDashboardBucketCounts,
  createDashboardBucketCountsCache
} from '../dashboard/build-dashboard-bucket-counts'
import {
  selectAgentBucketCountState,
  type AgentBucketCountState
} from '../dashboard/useAgentBucketCounts'

export type ProjectAgentCounts = Record<DashboardBucket, number>

const cache = createDashboardBucketCountsCache()
let memo: { state: AgentBucketCountState; byProject: Map<string, ProjectAgentCounts> } | null = null

export function projectAgentCountsFor(
  state: AgentBucketCountState
): ReadonlyMap<string, ProjectAgentCounts> {
  if (memo?.state === state) {
    return memo.byProject
  }
  buildDashboardBucketCounts(state, Date.now(), cache, state.agentStatusEpoch)
  const byProject = new Map<string, ProjectAgentCounts>()
  for (const { projectId, worktree } of cache.activeWorkspaces?.workspaces ?? []) {
    const tally = cache.tallyByWorktree.get(worktree.id)?.tally
    if (!tally) {
      continue
    }
    const sum = byProject.get(projectId) ?? { attention: 0, working: 0, done: 0, idle: 0 }
    sum.attention += tally.attention
    sum.working += tally.working
    sum.done += tally.done
    sum.idle += tally.idle
    byProject.set(projectId, sum)
  }
  memo = { state, byProject }
  return byProject
}

export function useProjectAgentCounts(projectId: string): ProjectAgentCounts | undefined {
  const state = useAppStore(selectAgentBucketCountState)
  return projectAgentCountsFor(state).get(projectId)
}
