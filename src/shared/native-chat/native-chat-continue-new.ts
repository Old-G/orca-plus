// Custom build (chat-continue-new, T6 of plan 2026-11-14-lead-models-limits): when a long Claude chat
// left idle should offer «Continue in new chat». Its prompt cache lives an hour; past that the next
// message writes the whole context to the cache again, out of the subscription's limit (14.11 week:
// 157 such returns, 11% of all use). A new chat started from the saved record begins far smaller.

/** The prompt cache of a Claude chat lives this long after its last call. */
export const CONTINUE_NEW_IDLE_MS = 60 * 60_000
/** Below this a re-read costs little; the owner's threshold, 14.11 (card 12a). */
export const CONTINUE_NEW_MIN_TOKENS = 200_000

/** The newest timestamp among the chat's messages; null when none carries one. */
export function lastNativeChatActivityAt(
  messages: readonly { timestamp: number | null }[]
): number | null {
  let last: number | null = null
  for (const message of messages) {
    if (message.timestamp !== null && (last === null || message.timestamp > last)) {
      last = message.timestamp
    }
  }
  return last
}

/** Whether the chat is big and idle enough that the next message would re-read all of it. */
export function nativeChatContinueNewDue(args: {
  usedTokens: number | null
  lastActivityAt: number | null
  isWorking: boolean
  now: number
}): boolean {
  const { usedTokens, lastActivityAt, isWorking, now } = args
  return (
    !isWorking &&
    usedTokens !== null &&
    usedTokens > CONTINUE_NEW_MIN_TOKENS &&
    lastActivityAt !== null &&
    now - lastActivityAt > CONTINUE_NEW_IDLE_MS
  )
}

/** When a chat not yet due becomes due, so the view can wake once then; null when it never will. */
export function nativeChatContinueNewDueAt(args: {
  usedTokens: number | null
  lastActivityAt: number | null
  isWorking: boolean
}): number | null {
  const { usedTokens, lastActivityAt, isWorking } = args
  if (isWorking || usedTokens === null || usedTokens <= CONTINUE_NEW_MIN_TOKENS) {
    return null
  }
  return lastActivityAt === null ? null : lastActivityAt + CONTINUE_NEW_IDLE_MS + 1
}
