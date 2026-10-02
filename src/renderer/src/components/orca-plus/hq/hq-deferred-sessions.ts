// Custom build (hq): HQ's deferred sessions — agents quiet past a threshold whose work still looks
// unfinished: changes left in the workspace, a question at the end, an interrupt, a limit stop, or
// a handoff waiting. Each quiet spell is listed until the user closes it.
import type { DashboardCard } from '../../../../../shared/dashboard-snapshot'
import type { HqWorktreeGitState } from '../../../../../shared/hq-project-pages'
import { hqAnswerAsksUser } from './hq-deferred-text'

export const HQ_DEFERRED_DEFAULT_MINUTES = 30
// Why: a session quiet for a week was abandoned, not deferred; listing it is noise.
const MAX_QUIET_MS = 7 * 86_400_000

export type HqDeferredReason =
  | { kind: 'changes'; count: number }
  | { kind: 'ahead'; count: number }
  | { kind: 'asks' }
  | { kind: 'interrupted' }
  | { kind: 'limit' }
  | { kind: 'handoff' }

export type HqDeferredSession = {
  card: DashboardCard
  /** When the quiet spell began; closing a session closes this spell only. */
  silentSince: number
  reasons: HqDeferredReason[]
  /** The handoff a new session would continue from, when one is waiting. */
  handoffId: string | null
}

export type HqDeferredInput = {
  cards: readonly DashboardCard[]
  now: number
  thresholdMinutes: number
  /** By worktree id; missing or null means unknown, which is not evidence of anything. */
  gitStates: Readonly<Record<string, HqWorktreeGitState | null | undefined>>
  interruptedPaneKeys: ReadonlySet<string>
  limitStops: readonly { paneKey: string | null; worktreeId: string }[]
  handoffs: readonly { id: string; worktreeId: string }[]
  dismissed: Readonly<Record<string, number>>
}

function silentSince(card: DashboardCard): number | null {
  if (card.bucket !== 'done' && card.bucket !== 'idle') {
    return null
  }
  const since = card.finishedAt ?? card.stateChangedAt
  return since > 0 ? since : null
}

/** Agents quiet long enough to be judged; their workspaces are the ones worth a git read. */
export function hqDeferredCandidates(
  cards: readonly DashboardCard[],
  now: number,
  thresholdMinutes: number
): DashboardCard[] {
  const threshold = Math.max(1, thresholdMinutes) * 60_000
  return cards.filter((card) => {
    const since = silentSince(card)
    return since !== null && now - since >= threshold && now - since <= MAX_QUIET_MS
  })
}

export function buildHqDeferredSessions(input: HqDeferredInput): HqDeferredSession[] {
  const candidates = hqDeferredCandidates(input.cards, input.now, input.thresholdMinutes)
  // Why: the workspace's leftovers belong to the session that last worked there, not to every
  // older chat that ever ran in it.
  const lastInWorktree = new Map<string, string>()
  for (const card of [...candidates].sort(
    (a, b) => (silentSince(a) ?? 0) - (silentSince(b) ?? 0)
  )) {
    lastInWorktree.set(card.worktreeId, card.paneKey)
  }
  const sessions: HqDeferredSession[] = []
  for (const card of candidates) {
    const since = silentSince(card)
    if (since === null || input.dismissed[card.paneKey] === since) {
      continue
    }
    const reasons: HqDeferredReason[] = []
    const git =
      lastInWorktree.get(card.worktreeId) === card.paneKey
        ? input.gitStates[card.worktreeId]
        : undefined
    if (git && git.changes > 0) {
      reasons.push({ kind: 'changes', count: git.changes })
    }
    if (git && git.ahead > 0) {
      reasons.push({ kind: 'ahead', count: git.ahead })
    }
    if (hqAnswerAsksUser(card.lastAgentMessage)) {
      reasons.push({ kind: 'asks' })
    }
    if (input.interruptedPaneKeys.has(card.paneKey)) {
      reasons.push({ kind: 'interrupted' })
    }
    // Why: a chat's stop carries its session, not a pane key; its workspace is what ties it here.
    if (
      input.limitStops.some((stop) =>
        stop.paneKey ? stop.paneKey === card.paneKey : stop.worktreeId === card.worktreeId
      )
    ) {
      reasons.push({ kind: 'limit' })
    }
    const handoff = input.handoffs.find((offer) => offer.worktreeId === card.worktreeId)
    if (handoff) {
      reasons.push({ kind: 'handoff' })
    }
    if (reasons.length > 0) {
      sessions.push({ card, silentSince: since, reasons, handoffId: handoff?.id ?? null })
    }
  }
  return sessions.sort((a, b) => a.silentSince - b.silentSince)
}

/** The closed spells still worth remembering: those of agents that are still listed. */
export function pruneHqDeferredDismissed(
  dismissed: Readonly<Record<string, number>>,
  cards: readonly DashboardCard[]
): Record<string, number> {
  const live = new Set(cards.map((card) => card.paneKey))
  return Object.fromEntries(Object.entries(dismissed).filter(([paneKey]) => live.has(paneKey)))
}
