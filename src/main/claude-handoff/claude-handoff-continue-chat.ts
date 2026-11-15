// Custom build (chat-continue-new, T6 of plan 2026-11-14-lead-models-limits): «Continue in new chat»
// for a long native chat left idle. The window builds the prompt from the chat's saved record, so the
// old chat is never woken to write a handoff file; main starts the successor as a handoff's would.
// Kept apart from the IPC module so the checks are testable without Electron.
import type { ClaudeHandoffLaunchResult } from '../../shared/claude-handoff-file'

const NATIVE_CHAT_TAB = 'structured-agent-session-'

export type ClaudeContinueChatStart = (args: {
  worktreeId: string
  from: { worktreeId: string; tabId: string }
  prompt: string
}) => Promise<ClaudeHandoffLaunchResult>

/** The IPC handler's body: checks what the window sent and starts one successor per chat at a time. */
export function createClaudeContinueChat(
  start: ClaudeContinueChatStart
): (worktreeId: unknown, tabId: unknown, prompt: unknown) => Promise<ClaudeHandoffLaunchResult> {
  const starting = new Set<string>()
  return async (worktreeId, tabId, prompt) => {
    if (
      typeof worktreeId !== 'string' ||
      !worktreeId ||
      typeof tabId !== 'string' ||
      !tabId.startsWith(NATIVE_CHAT_TAB) ||
      tabId.length === NATIVE_CHAT_TAB.length ||
      typeof prompt !== 'string' ||
      !prompt.trim()
    ) {
      return { ok: false, error: 'This chat cannot be continued in a new chat.' }
    }
    if (starting.has(tabId)) {
      return { ok: false, error: 'The new chat is already starting.' }
    }
    starting.add(tabId)
    try {
      return await start({ worktreeId, from: { worktreeId, tabId }, prompt })
    } finally {
      starting.delete(tabId)
    }
  }
}
