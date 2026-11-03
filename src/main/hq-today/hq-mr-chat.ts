// Custom build (hq-ledger-own-mrs, plan 20.5 С7): a reviewer's «fix this here» on the owner's MR goes
// with the chat that made the MR — the one working in the Orca worktree on the MR's branch, or the
// chat it handed its work to.
import { listHqProjectPages } from '../hq-project-pages/hq-project-pages'
import { branchSelectorMatches } from '../runtime/workspaces/catalog/runtime-worktree-path-identity'
import type { Store } from '../persistence/loading-store/store'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'

export type HqMrChatDeps = {
  chatOfBranch?: (project: string, branch: string) => Promise<string | null>
  /** The chat a conversation goes with. */
  setChat?: (key: string, sessionId: string) => void
}

/** A reviewer turning to the owner on his own MR: its conversation goes with the chat that made it. */
export async function hqMrChatFor(
  deps: HqMrChatDeps,
  mr: {
    key: string
    project: string
    owner: string
    todo: { mrAuthor: string | null; sourceBranch?: string | null }
  }
): Promise<void> {
  if (!mr.todo.sourceBranch || mr.todo.mrAuthor?.toLowerCase() !== mr.owner.toLowerCase()) {
    return
  }
  const chat = await deps.chatOfBranch?.(mr.project, mr.todo.sourceBranch).catch(() => null)
  if (chat) {
    deps.setChat?.(mr.key, chat)
  }
}

/** Why a month: an MR under review can sit a few weeks; its chat is still the one that knows it. */
const CHAT_WINDOW_MS = 30 * 24 * 60 * 60_000

/** The chat for an MR's branch in an HQ project; null when no Orca chat worked there. */
export function hqMrChatOfBranch(
  store: Store,
  runtime: OrcaRuntimeService
): (project: string, branch: string) => Promise<string | null> {
  return async (project, branch) => {
    const hq = store.getSettings().hqPath
    const page = hq
      ? (await listHqProjectPages(hq).catch(() => [])).find((entry) => entry.slug === project)
      : undefined
    const repo = page ? store.getRepo(page.repoId) : undefined
    if (!repo) {
      return null
    }
    // Why the runtime's listing: an SSH repo's path lives on its host; desktop Git cannot list it.
    const { worktrees } = await runtime
      .listManagedWorktrees(undefined, Number.MAX_SAFE_INTEGER)
      .catch(() => ({ worktrees: [] }))
    const worktreeId = worktrees.find(
      (worktree) => worktree.repoId === repo.id && branchSelectorMatches(worktree.branch, branch)
    )?.id
    if (!worktreeId) {
      return null
    }
    const chat = runtime
      .pulseListRecentSessions(Date.now() - CHAT_WINDOW_MS)
      .filter((session) => session.worktreeId === worktreeId)
      .toSorted((a, b) => b.lastActivityAt - a.lastActivityAt)[0]
    // Why the live end: a chat that handed its work on is closed; the new one holds the MR now.
    return chat ? runtime.pulseLiveSessionOf(chat.sessionId) : null
  }
}
