// Custom build (claude-handoff-launch): where a handoff's successor opens and how the chat that wrote
// it is closed. Kept apart from the IPC module so both rules are testable without Electron.
import type { ClaudeHandoffOffer } from '../../shared/claude-handoff-file'

const NATIVE_CHAT_TAB = 'structured-agent-session-'

/**
 * Beside the chat that wrote the handoff, not where its file lies: a chat that moved into a worktree
 * mid-session writes its handoff there, and a successor opened in that worktree went unseen while
 * the owner was in the old chat's workspace (01.11: he started a second one by hand). The prompt
 * names the handoff's absolute path, so the new chat finds the work wherever it opens.
 */
export function claudeHandoffSuccessorWorktreeId(offer: ClaudeHandoffOffer): string {
  return offer.tabWorktreeId ?? offer.worktreeId
}

export type ClaudeHandoffCloseDeps = {
  /** The runtime's close, as the tab's ×; throws when the runtime does not know the tab. */
  closeInRuntime: (worktreeSelector: string, tabId: string) => Promise<unknown>
  /** Asks Orca's window to close the tab itself; false when no window is open. */
  closeInWindow: (tabId: string) => boolean
  log: (message: string) => void
}

export type ClaudeHandoffCloseOutcome = 'not-a-chat' | 'runtime' | 'window' | 'failed'

/**
 * Closes the chat that wrote the handoff once its successor started, so it stays reopenable from
 * History. The runtime knows only the tabs Orca's window has published since it started; for any
 * other (01.11: «tab_not_found», the old chat left open and continued by hand, twice) the window,
 * which holds every tab, closes it the way chat cleanup does.
 */
export async function closeClaudeHandedOffChat(
  deps: ClaudeHandoffCloseDeps,
  offer: ClaudeHandoffOffer,
  launchedTabId: string | undefined
): Promise<ClaudeHandoffCloseOutcome> {
  if (!offer.tabId?.startsWith(NATIVE_CHAT_TAB) || offer.tabId === launchedTabId) {
    return 'not-a-chat'
  }
  try {
    await deps.closeInRuntime(`id:${offer.tabWorktreeId ?? offer.worktreeId}`, offer.tabId)
    return 'runtime'
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error)
    if (deps.closeInWindow(offer.tabId)) {
      deps.log(`the runtime could not close the handed-off chat (${why}); the window closes it`)
      return 'window'
    }
    deps.log(`closing the handed-off chat failed: ${why}`)
    return 'failed'
  }
}
