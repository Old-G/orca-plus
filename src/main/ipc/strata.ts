// Custom build (strata-status): per-project Strata status for the sidebar, and a user-started
// `strata:adopt` in a new worktree through the same `agent.launch` RPC the CLI uses.
import { randomUUID } from 'node:crypto'
import { ipcMain } from 'electron'
import type { Store } from '../persistence'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import { RpcDispatcher } from '../runtime/rpc/dispatcher'
import { AGENT_LAUNCH_METHODS } from '../runtime/rpc/methods/agent-launch'
import { readStrataStatus } from '../strata/strata-status-probe'
import { isGitRepoKind } from '../../shared/repo-kind'
import {
  STRATA_ADOPT_PROMPT,
  STRATA_ADOPT_WORKTREE_NAME,
  type StrataAdoptResult,
  type StrataStatus
} from '../../shared/strata-status'

function readLaunchedWorktreeId(result: unknown): string | null {
  if (result && typeof result === 'object' && 'worktreeId' in result) {
    return typeof result.worktreeId === 'string' ? result.worktreeId : null
  }
  return null
}

export function registerStrataHandlers(store: Store, runtime: OrcaRuntimeService): void {
  const dispatcher = new RpcDispatcher({ runtime, methods: AGENT_LAUNCH_METHODS })
  const adopting = new Set<string>()

  ipcMain.handle(
    'strata:status',
    async (_event, repoIds: unknown): Promise<Record<string, StrataStatus>> => {
      const ids = Array.isArray(repoIds)
        ? repoIds.filter((id): id is string => typeof id === 'string')
        : []
      const entries = await Promise.all(
        ids.map(async (id): Promise<[string, StrataStatus]> => {
          const repo = store.getRepo(id)
          return [id, repo ? await readStrataStatus(repo) : 'unknown']
        })
      )
      return Object.fromEntries(entries)
    }
  )

  ipcMain.handle('strata:adopt', async (_event, repoId: unknown): Promise<StrataAdoptResult> => {
    const repo = typeof repoId === 'string' ? store.getRepo(repoId) : undefined
    if (!repo || !isGitRepoKind(repo)) {
      return { ok: false, error: 'Strata is adopted in a new worktree, so it needs a git project.' }
    }
    if (adopting.has(repo.id)) {
      return { ok: false, error: 'Strata adoption is already starting for this project.' }
    }
    adopting.add(repo.id)
    try {
      const response = await dispatcher.dispatch({
        id: randomUUID(),
        authToken: '',
        method: 'agent.launch',
        params: {
          agent: 'claude',
          target: {
            kind: 'create-worktree',
            create: { repo: `id:${repo.id}`, name: STRATA_ADOPT_WORKTREE_NAME }
          },
          prompt: { text: STRATA_ADOPT_PROMPT, delivery: 'submit' }
        }
      })
      if (!response.ok) {
        return { ok: false, error: response.error.message }
      }
      const worktreeId = readLaunchedWorktreeId(response.result)
      return worktreeId
        ? { ok: true, worktreeId }
        : { ok: false, error: 'The agent started, but its worktree was not reported.' }
    } finally {
      adopting.delete(repo.id)
    }
  })
}
