// Custom build (hq-handoff-auto, owner 24.11): one handoff, one new chat — whoever starts first, Orca+
// or the chat itself with `orca agent launch`. Keyed by the old chat's Orca session id.

type Claim = { by: 'orca' | 'agent'; at: number; successorSessionId?: string }

export type ClaudeHandoffClaimAnswer =
  | { taken: false }
  | { taken: true; successorSessionId?: string }

export type ClaudeHandoffClaims = {
  /** The chat is about to start its own successor; taken when Orca+ already started or is starting one. */
  claimForAgent: (fromSessionId: string) => ClaudeHandoffClaimAnswer
  /** Orca+ is about to start one; false when the chat or Orca+ itself is starting or started it. */
  claimForOrca: (fromSessionId: string) => boolean
  started: (fromSessionId: string, successorSessionId: string | undefined) => void
  release: (fromSessionId: string) => void
}

// Why: the chat's own launch takes seconds; a launch that failed must not hold Orca+ off for long.
const AGENT_CLAIM_MS = 2 * 60_000
// Why: the chat runs its own launch within a minute of writing the file, so a few minutes cover it;
// keyed by the chat, a longer hold would turn away the chat's next handoff, its old chat staying open.
const ORCA_CLAIM_MS = 5 * 60_000

export function createClaudeHandoffClaims(now: () => number = Date.now): ClaudeHandoffClaims {
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
  return {
    claimForAgent: (fromSessionId) => {
      const claim = live(fromSessionId)
      if (claim?.by === 'orca') {
        return {
          taken: true,
          ...(claim.successorSessionId ? { successorSessionId: claim.successorSessionId } : {})
        }
      }
      claims.set(fromSessionId, { by: 'agent', at: now() })
      return { taken: false }
    },
    claimForOrca: (fromSessionId) => {
      if (live(fromSessionId)) {
        return false
      }
      claims.set(fromSessionId, { by: 'orca', at: now() })
      return true
    },
    started: (fromSessionId, successorSessionId) => {
      const claim = claims.get(fromSessionId)
      if (claim?.by === 'orca' && successorSessionId) {
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

export function getClaudeHandoffClaims(): ClaudeHandoffClaims {
  return (shared ??= createClaudeHandoffClaims())
}
