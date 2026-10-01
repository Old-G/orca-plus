/**
 * The subscription a native chat was opened on, keyed by its Orca session id until the create
 * resolves its account home. Local-only side channel: `agentSession.create` stays unchanged on the
 * wire, and a client that names nothing gets the default subscription. Once created, the session
 * record's `accountHome` is what every later acquire and resume reads.
 */
const ASSIGNMENT_TTL_MS = 10 * 60 * 1000

const assignments = new Map<string, { subscriptionId: string; expiresAt: number }>()

export function assignClaudeSubscriptionToSession(
  sessionId: string,
  subscriptionId: string,
  now: number = Date.now()
): void {
  for (const [key, value] of assignments) {
    if (value.expiresAt <= now) {
      assignments.delete(key)
    }
  }
  assignments.set(sessionId, { subscriptionId, expiresAt: now + ASSIGNMENT_TTL_MS })
}

/** Read, not consumed: a replayed create for the same session must resolve the same home. */
export function getAssignedClaudeSubscription(
  sessionId: string,
  now: number = Date.now()
): string | null {
  const assignment = assignments.get(sessionId)
  if (!assignment || assignment.expiresAt <= now) {
    return null
  }
  return assignment.subscriptionId
}
