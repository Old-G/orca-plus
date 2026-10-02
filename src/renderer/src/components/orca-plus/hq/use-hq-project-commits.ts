// Custom build (hq): a project's recent commits, read from the checkout its HQ card opens.
import { useEffect, useState } from 'react'
import type { GitHistoryItem } from '../../../../../shared/git-history-types'
import { getConnectionId } from '@/lib/connection-context'
import { getRuntimeGitHistory } from '@/runtime/runtime-git-client'
import { useAppStore } from '@/store'
import { settingsForRepoOwner } from '@/store/repos/owner-routing'

export type HqProjectCommitsState =
  | { status: 'none' }
  | { status: 'loading' }
  | { status: 'ready'; commits: GitHistoryItem[] }
  | { status: 'error'; message: string }

type Source = { repoId: string; worktreeId: string; worktreePath: string }
type Loaded = { worktreeId: string; state: HqProjectCommitsState }

/** `source` null: the project has no git checkout to read. */
export function useHqProjectCommits(source: Source | null, limit: number): HqProjectCommitsState {
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const repoId = source?.repoId
  const worktreeId = source?.worktreeId
  const worktreePath = source?.worktreePath
  useEffect(() => {
    if (!repoId || !worktreeId || !worktreePath) {
      return
    }
    let alive = true
    const settle = (state: HqProjectCommitsState): void => {
      if (alive) {
        setLoaded({ worktreeId, state })
      }
    }
    getRuntimeGitHistory(
      {
        // Why: route the read by the repo's owner host, as the source-control history does.
        settings: settingsForRepoOwner(useAppStore.getState(), repoId),
        worktreeId,
        worktreePath,
        connectionId: getConnectionId(worktreeId) ?? undefined
      },
      { limit }
    )
      .then((result) => settle({ status: 'ready', commits: result.items }))
      .catch((error: unknown) =>
        settle({ status: 'error', message: error instanceof Error ? error.message : String(error) })
      )
    return () => {
      alive = false
    }
  }, [repoId, worktreeId, worktreePath, limit])
  if (!worktreeId) {
    return { status: 'none' }
  }
  return loaded?.worktreeId === worktreeId ? loaded.state : { status: 'loading' }
}
