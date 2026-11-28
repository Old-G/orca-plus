// Custom build (pulse-wake, C2): `pulse wait add --wake <chat>` names the chat the answer brings back.

export type PulseWakeLookup = {
  /** True when this host has a chat with that session id, open or closed. */
  isChat: (sessionId: string) => boolean
  /** The chats on a thread address, newest first. */
  byAddress: (address: string) => readonly { sessionId: string }[]
  /** The live end of a chat's handoff chain. */
  liveOf: (sessionId: string) => string
}

/** The session id to wake, followed to the live end of its handoff chain; null for no such chat. */
export function resolvePulseWakeChat(value: string, lookup: PulseWakeLookup): string | null {
  const target = value.trim()
  if (!target) {
    return null
  }
  const sessionId = lookup.isChat(target) ? target : lookup.byAddress(target)[0]?.sessionId
  return sessionId ? lookup.liveOf(sessionId) : null
}

export function pulseWakeUnknown(value: string): string {
  return `--wake: no chat «${value}» on this Mac — give its address (<project>/<task>, see \`orca hq sessions\`) or its session id`
}
