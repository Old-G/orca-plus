// Custom build (hq-chat-roles, owner 14.11): a native chat's process sees the role it was launched with
// as ORCA_CHAT_ROLE, on every start of it, a resume after a restart included — hooks read the role
// instead of guessing it from the prompt.
import { ORCA_CHAT_ROLE_ENV, type HqChatRole } from '../../../shared/hq-chat-role'

let readRole: ((sessionId: string) => HqChatRole | null) | null = null

export function bindChatRoleLookup(read: ((sessionId: string) => HqChatRole | null) | null): void {
  readRole = read
}

/** Custom build (chat-auto-effort-roles): the role the chat was launched with, for its effort. */
export function chatRoleOfSession(sessionId: string): HqChatRole | null {
  try {
    return readRole?.(sessionId) ?? null
  } catch (error) {
    console.warn('[chat-roles] the chat role could not be read', error)
    return null
  }
}

export function chatRoleChildEnv(sessionId: string): Record<string, string> {
  try {
    const role = readRole?.(sessionId) ?? null
    return role ? { [ORCA_CHAT_ROLE_ENV]: role } : {}
  } catch {
    // Why: the chat starts without its role rather than not at all.
    return {}
  }
}
