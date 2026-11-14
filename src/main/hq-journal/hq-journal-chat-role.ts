// Custom build (hq-chat-roles, owner 14.11): a chat's thread address and role, as `orca hq report`
// and a handoff see them — a new address is one no other chat holds, and the chat going on after a
// handoff keeps the role it was launched with.
import { hqChatAddress } from '../../shared/hq-journal'
import type { HqThreadsDeps } from './hq-journal-threads'

export function hqNewChatAddress(
  deps: Pick<HqThreadsDeps, 'pulse' | 'sessionName'>,
  project: string | null,
  sessionId: string
): string {
  return hqChatAddress(project, deps.sessionName(sessionId), sessionId, {
    role: deps.pulse.roleOf?.(sessionId) ?? null,
    taken: (candidate) =>
      deps.pulse.listSessionsByAddress(candidate).some((other) => other.sessionId !== sessionId)
  })
}

export function hqCarryChatRole(
  pulse: HqThreadsDeps['pulse'],
  fromSessionId: string,
  toSessionId: string,
  at: number
): void {
  const role = pulse.roleOf?.(fromSessionId) ?? null
  if (role && !pulse.roleOf?.(toSessionId)) {
    pulse.setRole?.({ sessionId: toSessionId, role, at })
  }
}
