// Custom build (hq-plus-ladder): the trust ladder (plan 17.12) — every owner decision lands in the
// journal as `owner.decision` with the kind of action and what he chose; per kind a step in
// HQ/routing.yaml says how far the system may act alone, and the counts say when to move it.
export const HQ_OWNER_DECISION_KIND = 'owner.decision'
/** Custom build (hq-plus-ladder): the effort a chat's message went with, as the classifier picked it. */
export const HQ_CHAT_EFFORT_KIND = 'chat.effort'

export const HQ_LADDER_OUTCOMES = ['accepted', 'edited', 'rejected', 'deferred'] as const
export type HqLadderOutcome = (typeof HQ_LADDER_OUTCOMES)[number]

/** 0 suggest · 1 acts with a card · 2 acts and says so · 3 acts quietly (only by the owner's word). */
export type HqLadderStep = 0 | 1 | 2 | 3

export type HqLadderRung = {
  step: HqLadderStep
  /** The owner's own yes for this kind of message to people to go past step 1. */
  allowPeople: boolean
}

export type HqLadder = Record<string, HqLadderRung>

const SOURCE = /^owner:([a-z0-9:._-]{1,80}):(accepted|edited|rejected|deferred)$/

export function hqOwnerDecisionSource(kind: string, outcome: HqLadderOutcome): string {
  return `owner:${kind}:${outcome}`
}

export function readHqOwnerDecisionSource(
  source: string | null
): { kind: string; outcome: HqLadderOutcome } | null {
  const match = source ? SOURCE.exec(source) : null
  const outcome = HQ_LADDER_OUTCOMES.find((value) => value === match?.[2])
  return match && outcome ? { kind: match[1], outcome } : null
}

/** «Slack · send message» → `slack-send-message`: the kind an Approve card's call stands for. */
export function hqApprovalKind(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  return slug || 'approval'
}

/** Why a kind can never act alone, or only with the owner's own yes; null when nothing holds it. */
export function hqLadderCap(kind: string, rung: HqLadderRung | undefined): string | null {
  if (/^(?:remote|git)-|delete|drop|force/.test(kind)) {
    return 'prod or irreversible — stays at step 1'
  }
  if (/send-message|create-comment|gmail|reply/.test(kind) && !rung?.allowPeople) {
    return 'a message to people — past step 1 only on your own yes for this kind'
  }
  return null
}

export type HqLadderDecision = { kind: string; outcome: HqLadderOutcome; at: number }

export type HqLadderKindStats = {
  kind: string
  step: HqLadderStep
  total: number
  accepted: number
  edited: number
  rejected: number
  deferred: number
  /** Accepted as offered, of the decided ones (deferred left out); null when none were decided. */
  match: number | null
  proposal: { to: HqLadderStep; why: string } | null
  /** Why a raise the counts would give is held back. */
  held: string | null
}

const NEXT_STEP: Record<HqLadderStep, HqLadderStep> = { 0: 1, 1: 2, 2: 3, 3: 3 }

// Plan 17.12: 0→1 at ≥20 cases and ≥90% match; 1→2 at ≥50 cases and ≤5% changed; 3 only by word.
const RAISE = [
  {
    from: 0,
    cases: 20,
    ok: (s: { match: number }) => s.match >= 0.9,
    why: '≥20 cases, ≥90% as offered'
  },
  {
    from: 1,
    cases: 50,
    ok: (s: { match: number }) => s.match >= 0.95,
    why: '≥50 cases, ≤5% changed'
  }
] as const

export function hqLadderStats(
  decisions: readonly HqLadderDecision[],
  ladder: HqLadder
): HqLadderKindStats[] {
  const kinds = new Set([...decisions.map((decision) => decision.kind), ...Object.keys(ladder)])
  return [...kinds]
    .map((kind) => {
      const own = decisions.filter((decision) => decision.kind === kind).sort((a, b) => a.at - b.at)
      const count = (outcome: HqLadderOutcome): number =>
        own.filter((decision) => decision.outcome === outcome).length
      const rung = ladder[kind]
      const step = rung?.step ?? 0
      const stats = {
        kind,
        step,
        total: own.length,
        accepted: count('accepted'),
        edited: count('edited'),
        rejected: count('rejected'),
        deferred: count('deferred')
      }
      const decided = stats.accepted + stats.edited + stats.rejected
      const match = decided > 0 ? stats.accepted / decided : null
      const lastTwo = own.filter((decision) => decision.outcome !== 'deferred').slice(-2)
      let proposal: HqLadderKindStats['proposal'] = null
      let held: string | null = null
      if (
        step >= 2 &&
        lastTwo.length === 2 &&
        lastTwo.every((decision) => decision.outcome !== 'accepted')
      ) {
        proposal = { to: step === 3 ? 2 : 1, why: 'two changes or refusals in a row' }
      } else {
        const rule = RAISE.find((candidate) => candidate.from === step)
        if (rule && match !== null && decided >= rule.cases && rule.ok({ match })) {
          const cap = step >= 1 ? hqLadderCap(kind, rung) : null
          if (cap) {
            held = cap
          } else {
            proposal = { to: NEXT_STEP[step], why: rule.why }
          }
        }
      }
      return { ...stats, match, proposal, held }
    })
    .sort((a, b) => b.total - a.total || a.kind.localeCompare(b.kind))
}

/** What `orca hq ladder` answers: per kind, and the effort each chat message went with. */
export type HqLadderReport = {
  since: number
  kinds: HqLadderKindStats[]
  effort: { result: string; effort: string; count: number }[]
  problems: string[]
}
