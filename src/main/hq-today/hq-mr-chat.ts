// Custom build (hq-ledger-own-mrs, plan 20.5 С7): a reviewer's «fix this here» on the owner's MR goes
// with the chat that made the MR — the one working in the Orca worktree on the MR's branch, or the
// chat it handed its work to.
import { listHqProjectPages } from '../hq-project-pages/hq-project-pages'
import { gitExecFileAsync } from '../git/runner'
import type { Store } from '../persistence'
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

/** The worktree path holding `branch` in `git worktree list --porcelain` output; null when none. */
export function hqWorktreeOfBranch(porcelain: string, branch: string): string | null {
  let path: string | null = null
  for (const line of porcelain.split('\n')) {
    if (line.startsWith('worktree ')) {
      path = line.slice('worktree '.length).trim()
    } else if (line.trim() === `branch refs/heads/${branch}` && path) {
      return path
    }
  }
  return null
}

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
    const listed = await gitExecFileAsync(['worktree', 'list', '--porcelain'], { cwd: repo.path })
      .then((result) => result.stdout)
      .catch(() => '')
    const path = hqWorktreeOfBranch(listed, branch)
    if (!path) {
      return null
    }
    const worktreeId = `${repo.id}::${path}`
    const chat = runtime
      .pulseListRecentSessions(Date.now() - CHAT_WINDOW_MS)
      .filter((session) => session.worktreeId === worktreeId)
      .toSorted((a, b) => b.lastActivityAt - a.lastActivityAt)[0]
    // Why the live end: a chat that handed its work on is closed; the new one holds the MR now.
    return chat ? runtime.pulseLiveSessionOf(chat.sessionId) : null
  }
}
