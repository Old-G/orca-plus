// Custom build (chat-default-model, owner 14.11): a Claude chat that names no model never starts on
// Fable. The saved selection is the last model picked in any chat, so one Fable pick used to put
// every later launch without `--model` (CLI, handoff, dispatcher, HQ take) on Fable at its effort.
// Fable stays an explicit choice: `--model fable`, or a pick in the chat it is meant for.

import type { PersistedNativeChatSessionOptions } from './native-chat-session-options'

/** What a saved Fable pick is read as: the CLI's Opus alias, listed on every host. */
export const CLAUDE_NEW_CHAT_MODEL = 'opus'

/** `fable`, `fable[1m]`, `claude-fable-5-2`, `claude-fable-5-2[1m]`; never a name that only contains it. */
export function isFableModel(model: string | null | undefined): boolean {
  return typeof model === 'string' && /^(claude-)?fable(?![a-z0-9])/iu.test(model.trim())
}

/** The saved selection a new chat may start from: a saved Fable becomes Opus with Opus's own saved
 *  values, so Fable's effort does not ride along. Anything else comes back as it was passed. */
export function savedSelectionForNewChat(
  persisted: PersistedNativeChatSessionOptions | null | undefined
): PersistedNativeChatSessionOptions | null | undefined {
  const claude = persisted?.claude
  if (!claude || !isFableModel(claude.model)) {
    return persisted
  }
  return { ...persisted, claude: { ...claude, model: CLAUDE_NEW_CHAT_MODEL } }
}
