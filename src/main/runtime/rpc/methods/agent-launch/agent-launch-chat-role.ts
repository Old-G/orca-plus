// Custom build (hq-chat-roles, owner 14.11): `--role` of a chat launch, kept by Orca+ with the chat.
import {
  HQ_CHAT_ROLE_SESSION_OPTION,
  isHqChatRole,
  type HqChatRole
} from '../../../../../shared/hq-chat-role'

type ChatRoleStore = {
  setRole: (input: { sessionId: string; role: HqChatRole; at: number }) => void
  roleOf: (sessionId: string) => HqChatRole | null
  clearRole: (sessionId: string) => void
}

function keep(write: () => void): void {
  try {
    write()
  } catch (error) {
    console.warn('[hq-chat-roles] could not keep the chat role:', error)
  }
}

/** Runs `create` with the role kept before the process starts, so its env carries ORCA_CHAT_ROLE.
 *  A refused or failed create puts back what the session had: a caller naming an id that is taken
 *  must not retag that chat (Codex 15.11). Bookkeeping only: the pulse store never fails a launch. */
export async function createKeepingChatRole<T extends { ok: boolean }>(
  pulse: () => ChatRoleStore,
  sessionId: string,
  options: Readonly<Record<string, unknown>> | undefined,
  create: () => Promise<T>
): Promise<T> {
  const role = options?.[HQ_CHAT_ROLE_SESSION_OPTION]
  if (!isHqChatRole(role)) {
    return create()
  }
  let before: HqChatRole | null = null
  keep(() => {
    before = pulse().roleOf(sessionId)
  })
  keep(() => pulse().setRole({ sessionId, role, at: Date.now() }))
  const restore = (): void => {
    if (before === role) {
      return
    }
    const previous: HqChatRole | null = before
    keep(() =>
      previous
        ? pulse().setRole({ sessionId, role: previous, at: Date.now() })
        : pulse().clearRole(sessionId)
    )
  }
  let created: T
  try {
    created = await create()
  } catch (error) {
    restore()
    throw error
  }
  if (!created.ok) {
    restore()
  }
  return created
}
