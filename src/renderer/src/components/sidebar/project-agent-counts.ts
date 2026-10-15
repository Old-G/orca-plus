// Custom build (sidebar-summary): agent counts per project for the sidebar's project headers, one
// pass for every header — the per-workspace counts the dashboard projection already keeps, summed
// by project.
import { useCallback } from 'react'
import type { DashboardBucket } from '../../../../shared/agent-status/presentation/dashboard-snapshot'
import { useAppStore } from '@/store'
import type { AppState } from '@/store/types'
import type { AgentStatusProjection } from '@/store/slices/agent-status/projection/agent-status-projection'
import {
  selectFolderWorkspaces,
  selectWorktreesByRepo
} from '@/store/workspaces/catalog/workspace-record-fields'
import { collectActiveDashboardWorkspaces } from '../dashboard/snapshot/dashboard-snapshot-workspaces'
import { useAgentPresentation } from './workspace-card/activity/useWorktreeAgentRows'

export type ProjectAgentCounts = Record<DashboardBucket, number>

type OwnerInputs = {
  repos: AppState['repos']
  worktrees: unknown
  folders: unknown
  groups: AppState['projectGroups']
}
let owners: { inputs: OwnerInputs; projectByWorktree: ReadonlyMap<string, string> } | null = null

/** Workspace id → project id for the active workspaces, rebuilt only when the catalog changes. */
export function selectProjectByWorktree(state: AppState): ReadonlyMap<string, string> {
  const inputs: OwnerInputs = {
    repos: state.repos,
    worktrees: selectWorktreesByRepo(state),
    folders: selectFolderWorkspaces(state),
    groups: state.projectGroups
  }
  if (
    owners &&
    owners.inputs.repos === inputs.repos &&
    owners.inputs.worktrees === inputs.worktrees &&
    owners.inputs.folders === inputs.folders &&
    owners.inputs.groups === inputs.groups
  ) {
    return owners.projectByWorktree
  }
  const projectByWorktree = new Map(
    collectActiveDashboardWorkspaces(state, false).map(({ projectId, worktree }) => [
      worktree.id,
      projectId
    ])
  )
  owners = { inputs, projectByWorktree }
  return projectByWorktree
}

let memo: ReadonlyMap<string, ProjectAgentCounts> = new Map()

function sameCounts(
  a: ReadonlyMap<string, ProjectAgentCounts>,
  b: ReadonlyMap<string, ProjectAgentCounts>
): boolean {
  if (a.size !== b.size) {
    return false
  }
  for (const [id, x] of a) {
    const y = b.get(id)
    if (
      !y ||
      x.attention !== y.attention ||
      x.working !== y.working ||
      x.done !== y.done ||
      x.idle !== y.idle
    ) {
      return false
    }
  }
  return true
}

export function projectAgentCountsFor(
  projection: Pick<AgentStatusProjection, 'dashboardCountsByWorktree'>,
  projectByWorktree: ReadonlyMap<string, string>
): ReadonlyMap<string, ProjectAgentCounts> {
  const byProject = new Map<string, ProjectAgentCounts>()
  for (const [worktreeId, tally] of projection.dashboardCountsByWorktree()) {
    const projectId = projectByWorktree.get(worktreeId)
    if (!projectId) {
      continue
    }
    const sum = byProject.get(projectId) ?? { attention: 0, working: 0, done: 0, idle: 0 }
    sum.attention += tally.attention
    sum.working += tally.working
    sum.done += tally.done
    sum.idle += tally.idle
    byProject.set(projectId, sum)
  }
  // Why: the presentation hook compares by identity; equal sums keep the previous map.
  if (!sameCounts(byProject, memo)) {
    memo = byProject
  }
  return memo
}

export function useProjectAgentCounts(projectId: string): ProjectAgentCounts | undefined {
  const projectByWorktree = useAppStore(selectProjectByWorktree)
  const counts = useAgentPresentation(
    'dashboard-counts',
    useCallback(
      (projection: AgentStatusProjection) => projectAgentCountsFor(projection, projectByWorktree),
      [projectByWorktree]
    )
  )
  return counts.get(projectId)
}
