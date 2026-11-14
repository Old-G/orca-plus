// Custom build (claude-handoff-launch): the handoff file in a workspace, read where this machine can.
import { readFile, stat } from 'node:fs/promises'
import type { Store } from '../persistence/loading-store/store'
import type { PulseDb } from '../orca-plus/pulse/pulse-db'
import { joinWorktreeRelativePath } from '../runtime/files/paths/runtime-relative-paths'
import { claudeHandoffRelativePath } from '../../shared/claude-handoff-file'
import { splitWorktreeId } from '../../shared/worktree/id'

type Repos = Pick<Store, 'getRepo'>
type LaunchedChats = { pulseChats: () => Pick<PulseDb['chats'], 'launchedSince'> }

/** The file's path on this machine; null when it lives on an SSH or runtime host. */
function localWorktreeFilePath(
  store: Repos,
  worktreeId: string,
  relativePath: string
): string | null {
  const parsed = splitWorktreeId(worktreeId)
  const repo = parsed ? store.getRepo(parsed.repoId) : undefined
  // Why: a runtime-host workspace lives on another Orca, which reads its own files; an SSH host's
  // file this process cannot read either — unknown, not "absent".
  if (!parsed || !repo || repo.executionHostId?.startsWith('runtime:') || repo.connectionId) {
    return null
  }
  return joinWorktreeRelativePath(parsed.worktreePath, relativePath)
}

export async function readClaudeHandoffWorktreeFile(
  store: Repos,
  worktreeId: string,
  relativePath: string
): Promise<string | null> {
  const path = localWorktreeFilePath(store, worktreeId, relativePath)
  try {
    return path ? await readFile(path, 'utf-8') : null
  } catch {
    return null
  }
}

const NATIVE_CHAT_TAB = 'structured-agent-session-'

/**
 * Custom build (claude-handoff-model, owner 14.11): whether the chat started a chat with
 * `orca agent launch` after it wrote its handoff — its own successor. Since the earlier of the file's
 * mtime and its `created`: the agent guesses `created`, often late, and a chat that touches the file
 * after the launch moves its mtime past it. A chat launched after the handoff counts even when it is
 * a worker; one launched before does not. Links are by Orca's chat id, read from the chat's tab.
 */
export async function claudeHandoffSuccessorStarted(
  store: Repos,
  runtime: LaunchedChats,
  handoff: { worktreeId: string; sessionId: string; tabId?: string | undefined; created: string }
): Promise<boolean> {
  const chatId = handoff.tabId?.startsWith(NATIVE_CHAT_TAB)
    ? handoff.tabId.slice(NATIVE_CHAT_TAB.length)
    : null
  const relativePath = claudeHandoffRelativePath(handoff.sessionId)
  const path = relativePath ? localWorktreeFilePath(store, handoff.worktreeId, relativePath) : null
  if (!chatId || !path) {
    return false
  }
  try {
    const modifiedAt = Math.floor((await stat(path)).mtimeMs)
    const created = Date.parse(handoff.created)
    const since = Number.isNaN(created) ? modifiedAt : Math.min(modifiedAt, created)
    return runtime.pulseChats().launchedSince(chatId, since).length > 0
  } catch {
    return false
  }
}
