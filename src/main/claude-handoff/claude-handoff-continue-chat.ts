// Custom build (chat-continue-new, T6 of plan 2026-11-14-lead-models-limits): «Continue in new chat»
// for a long native chat left idle. The window builds the prompt from the chat's saved record, so the
// old chat is never woken to write a handoff file; main starts the successor as a handoff's would.
// Kept apart from the IPC module so the checks are testable without Electron.
import type { ClaudeHandoffLaunchResult } from '../../shared/claude-handoff-file'

const NATIVE_CHAT_TAB = 'structured-agent-session-'
const OPTION_MAX = 200

export type ClaudeContinueChatStart = (args: {
  worktreeId: string
  from: { worktreeId: string; tabId: string }
  prompt: string
  /** The old chat's model and effort as its own runtime reported them (a paired runtime's too). */
  options?: Record<string, string>
}) => Promise<ClaudeHandoffLaunchResult>

/** The model and effort the window read from the chat's runtime; anything else is left out. */
function reportedOptions(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== 'object') {
    return undefined
  }
  const options: Record<string, string> = {}
  for (const name of ['model', 'effort'] as const) {
    const option: unknown = Reflect.get(value, name)
    if (typeof option === 'string' && option.trim() && option.length <= OPTION_MAX) {
      options[name] = option.trim()
    }
  }
  return Object.keys(options).length > 0 ? options : undefined
}

/** The IPC handler's body: checks what the window sent and starts one successor per chat at a time. */
export function createClaudeContinueChat(
  start: ClaudeContinueChatStart
): (
  worktreeId: unknown,
  tabId: unknown,
  prompt: unknown,
  options?: unknown
) => Promise<ClaudeHandoffLaunchResult> {
  const starting = new Set<string>()
  return async (worktreeId, tabId, prompt, options) => {
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
      const reported = reportedOptions(options)
      return await start({
        worktreeId,
        from: { worktreeId, tabId },
        prompt,
        ...(reported ? { options: reported } : {})
      })
    } finally {
      starting.delete(tabId)
    }
  }
}
