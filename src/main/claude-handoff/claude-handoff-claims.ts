// Custom build (hq-handoff-auto, owner 24.11): one handoff, one new chat — whoever starts first, Orca+
// or the chat itself with `orca agent launch`. Keyed by the old chat's Orca session id.
// Custom build (hq-handoff-once, owner 27.11): the in-memory claims cover a start in flight; the HQ
// journal covers one that already happened. Before, a chat's own start was forgotten when its 2-minute
// claim lapsed and Orca+ started a second chat 2–3 min later (27.11 00:07/00:09, 00:34/00:37).

type Claim = { by: 'orca' | 'agent'; at: number; successorSessionId?: string }

export type ClaudeHandoffClaimAnswer =
  | { taken: false }
  | { taken: true; successorSessionId?: string }

/** The chat that continued `fromSessionId` at or after `since`; null when none did. */
export type ClaudeHandoffSuccessorLookup = (fromSessionId: string, since: number) => string | null

export type ClaudeHandoffClaims = {
  /** The chat is about to start its own successor; taken when one is starting or already started. */
  claimForAgent: (fromSessionId: string) => ClaudeHandoffClaimAnswer
  /** Orca+ is about to start one; false when the chat or Orca+ itself is starting or started it. */
  claimForOrca: (fromSessionId: string) => boolean
  /** The chat that already continues `fromSessionId` from a recent handoff; null when none does. */
  successorOf: (fromSessionId: string) => string | null
  started: (fromSessionId: string, successorSessionId: string | undefined) => void
  release: (fromSessionId: string) => void
}

// Why: the chat's own launch takes seconds; a launch that failed must not hold Orca+ off for long.
const AGENT_CLAIM_MS = 2 * 60_000
// Why: the chat runs its own launch within a minute of writing the file, so a few minutes cover it;
// keyed by the chat, a longer hold would turn away the chat's next handoff, its old chat staying open.
const ORCA_CLAIM_MS = 5 * 60_000
/**
 * Why: a handoff file counts as fresh this long (claude-handoff-offers FRESH_FOR_MS); a chat continued
 * within it has had its handoff started. The owner typing on in the old chat long after may hand off
 * again, and that one is its own.
 */
export const CLAUDE_HANDOFF_SUCCESSOR_WINDOW_MS = 30 * 60_000

export function createClaudeHandoffClaims(
  now: () => number = Date.now,
  lookup: () => ClaudeHandoffSuccessorLookup | null = () => null
): ClaudeHandoffClaims {
  const claims = new Map<string, Claim>()
  const live = (fromSessionId: string): Claim | null => {
    const claim = claims.get(fromSessionId)
    if (!claim) {
      return null
    }
    const ttl = claim.by === 'agent' ? AGENT_CLAIM_MS : ORCA_CLAIM_MS
    if (now() - claim.at > ttl) {
      claims.delete(fromSessionId)
      return null
    }
    return claim
  }
  const successorOf = (fromSessionId: string): string | null => {
    try {
      return lookup()?.(fromSessionId, now() - CLAUDE_HANDOFF_SUCCESSOR_WINDOW_MS) ?? null
    } catch (error) {
      // Why: an unreadable journal must not block a start; the in-memory claim still holds.
      console.warn('[claude-handoff] successor lookup failed:', error)
      return null
    }
  }
  return {
    claimForAgent: (fromSessionId) => {
      const claim = live(fromSessionId)
      if (claim?.by === 'orca') {
        return {
          taken: true,
          ...(claim.successorSessionId ? { successorSessionId: claim.successorSessionId } : {})
        }
      }
      const successor = successorOf(fromSessionId)
      if (successor) {
        return { taken: true, successorSessionId: successor }
      }
      claims.set(fromSessionId, { by: 'agent', at: now() })
      return { taken: false }
    },
    claimForOrca: (fromSessionId) => {
      if (live(fromSessionId) || successorOf(fromSessionId)) {
        return false
      }
      claims.set(fromSessionId, { by: 'orca', at: now() })
      return true
    },
    successorOf,
    started: (fromSessionId, successorSessionId) => {
      const claim = claims.get(fromSessionId)
      if (claim && successorSessionId) {
        claim.successorSessionId = successorSessionId
      }
    },
    release: (fromSessionId) => {
      if (claims.get(fromSessionId)?.by === 'orca') {
        claims.delete(fromSessionId)
      }
    }
  }
}

let shared: ClaudeHandoffClaims | null = null
let sharedLookup: ClaudeHandoffSuccessorLookup | null = null

/** Main wires the HQ journal in once it is up; until then only in-flight claims count. */
export function provideClaudeHandoffSuccessorLookup(value: ClaudeHandoffSuccessorLookup): void {
  sharedLookup = value
}

export function getClaudeHandoffClaims(): ClaudeHandoffClaims {
  return (shared ??= createClaudeHandoffClaims(Date.now, () => sharedLookup))
}
