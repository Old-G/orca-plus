// Custom build (claude-handoff-launch): turns a finished Claude turn that left a fresh handoff file
// into an offer the user can accept. It reads hook status only; it never derives agent status.
import type { EnrichedAgentHookEventPayload } from '../agent-hooks/server/server-types'
import {
  claudeHandoffRelativePath,
  parseClaudeHandoffFile,
  type ClaudeHandoffFile,
  type ClaudeHandoffOffer
} from '../../shared/claude-handoff-file'

export type ClaudeHandoffOfferDeps = {
  /** Null when the file is absent or the execution host cannot be read; never guessed. */
  readWorktreeFile: (worktreeId: string, relativePath: string) => Promise<string | null>
  describeWorktree: (worktreeId: string) => string
  onOffersChanged: (offers: ClaudeHandoffOffer[]) => void
  now?: () => number
  /** Whether Strata's context gate fired for the session; null when this host cannot tell. */
  contextGateFired?: (worktreeId: string, sessionId: string) => Promise<boolean | null>
  /** Handoffs the user already launched or dismissed; outlives a restart. */
  handled?: ClaudeHandoffHandledStore
}

export type ClaudeHandoffHandledStore = {
  has: (key: string) => boolean
  add: (key: string) => void
}

export type ClaudeHandoffOffers = {
  onStatus: (event: EnrichedAgentHookEventPayload) => Promise<void>
  list: () => ClaudeHandoffOffer[]
  /** The offer with its file as it is now; null when either is gone. The offer stays listed. */
  resolve: (id: string) => Promise<{ offer: ClaudeHandoffOffer; file: ClaudeHandoffFile } | null>
  dismiss: (id: string) => void
  /**
   * Whether the session wrote its handoff in the turn that stopped at `stoppedAt` — a turn cut off
   * by a usage limit ends without the `done` this module otherwise listens for. Raises the offer
   * if the user has not had it yet.
   */
  checkStoppedSession: (
    worktreeId: string,
    sessionId: string,
    stoppedAt: number
  ) => Promise<boolean>
}

// Why: the file is written in the very turn that stops, so an older one is a leftover.
const FRESH_FOR_MS = 30 * 60_000
const CLOCK_SKEW_MS = 5 * 60_000
const SEEN_LIMIT = 200

export function createClaudeHandoffOffers(deps: ClaudeHandoffOfferDeps): ClaudeHandoffOffers {
  const now = deps.now ?? Date.now
  const offers = new Map<string, ClaudeHandoffOffer>()
  // Why: one handoff must be offered once, even though every later Stop of that session sees it.
  const seen = new Set<string>()
  const reading = new Set<string>()

  const publish = (): void => deps.onOffersChanged([...offers.values()])
  const remember = (key: string): void => {
    seen.add(key)
    if (seen.size > SEEN_LIMIT) {
      seen.delete(seen.values().next().value ?? key)
    }
  }
  const read = async (worktreeId: string, sessionId: string): Promise<ClaudeHandoffFile | null> => {
    const relativePath = claudeHandoffRelativePath(sessionId)
    if (!relativePath) {
      return null
    }
    const content = await deps.readWorktreeFile(worktreeId, relativePath).catch(() => null)
    return content === null ? null : parseClaudeHandoffFile(content, sessionId)
  }

  const offerKey = (sessionId: string, created: string): string => `${sessionId}\n${created}`
  // Why: a handoff written for another reason (e.g. before a restart) must not offer a new session.
  const contextFilled = async (worktreeId: string, sessionId: string): Promise<boolean> =>
    (await deps.contextGateFired?.(worktreeId, sessionId)) !== false

  const raise = (worktreeId: string, sessionId: string, file: ClaudeHandoffFile): void => {
    const key = offerKey(sessionId, file.created)
    if (seen.has(key) || deps.handled?.has(key)) {
      return
    }
    remember(key)
    offers.set(sessionId, {
      id: sessionId,
      worktreeId,
      worktreeTitle: deps.describeWorktree(worktreeId),
      sessionId,
      created: file.created,
      branch: file.branch,
      head: file.head,
      pushed: file.pushed
    })
    publish()
  }

  return {
    onStatus: async (event) => {
      const sessionId =
        event.providerSession?.key === 'session_id' ? event.providerSession.id : null
      if (
        event.payload.agentType !== 'claude' ||
        event.payload.state !== 'done' ||
        event.isReplay ||
        event.restoredUnconfirmed ||
        !event.worktreeId ||
        !sessionId ||
        reading.has(sessionId)
      ) {
        return
      }
      const worktreeId = event.worktreeId
      reading.add(sessionId)
      try {
        const file = await read(worktreeId, sessionId)
        if (!file) {
          return
        }
        const age = now() - Date.parse(file.created)
        if (age > FRESH_FOR_MS || age < -CLOCK_SKEW_MS) {
          return
        }
        if (await contextFilled(worktreeId, sessionId)) {
          raise(worktreeId, sessionId, file)
        }
      } finally {
        reading.delete(sessionId)
      }
    },
    list: () => [...offers.values()],
    resolve: async (id) => {
      const offer = offers.get(id)
      if (!offer) {
        return null
      }
      const file = await read(offer.worktreeId, offer.sessionId)
      return file ? { offer, file } : null
    },
    dismiss: (id) => {
      const offer = offers.get(id)
      if (offer) {
        deps.handled?.add(offerKey(offer.sessionId, offer.created))
      }
      if (offers.delete(id)) {
        publish()
      }
    },
    checkStoppedSession: async (worktreeId, sessionId, stoppedAt) => {
      const file = await read(worktreeId, sessionId)
      if (!file) {
        return false
      }
      // Why: measured against the stop, not now — the limit may lift hours after the handoff.
      const beforeStop = stoppedAt - Date.parse(file.created)
      if (beforeStop > FRESH_FOR_MS || beforeStop < -CLOCK_SKEW_MS) {
        return false
      }
      // Why: with room left in the context the stopped session itself should resume.
      if (!(await contextFilled(worktreeId, sessionId))) {
        return false
      }
      raise(worktreeId, sessionId, file)
      return true
    }
  }
}
