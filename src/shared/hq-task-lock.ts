// Custom build (hq-task-lock, A3 28.11): one chat per row of a Lead's plan. `orca agent launch` and
// `orca worktree create --agent` take the row's lock in Orca+ before they start a worker: a second
// launch of the same row while its chat is open is refused with that chat's address; a closed holder
// hands the lock to the new chat. The row comes from the brief (skill lead), so no flag is needed —
// workers no longer keep `runs/<plan>/T<n>.lock` by hand (U1 audit: ~15 duplicate workers).

/** A row of a plan: the plan file's name in HQ/runs without `.md`, and the row id (`T3`, `A1A2`). */
export type HqTaskKey = { plan: string; row: string }

/** `--task none`: launch without taking a lock. */
export const HQ_TASK_LOCK_NONE = 'none'

export type HqTaskHolder = {
  sessionId: string
  address: string | null
  /** The chat's last known state (working, waiting, done…); null when Orca+ has none. */
  state: string | null
}

export type HqTaskClaimResult =
  | {
      taken: true
      ticket: string
      /** The chat that held the row before, now closed (or the caller handing on its own row). */
      movedFrom?: HqTaskHolder
    }
  | {
      taken: false
      /** `open`: the holder's chat is open; `starting`: another launch of the row is under way. */
      reason: 'open' | 'starting'
      holder: HqTaskHolder | null
      /** For `starting`: when that launch took the row. */
      since?: number
    }

// Row ids of the skill's plans: T3, T5c, A1A2, U4, S18b. Lowercase files (rakes, leads, retro) are not rows.
const ROW = '[A-Z][A-Za-z0-9]{0,23}'
const PLAN = '[0-9]{4}-[0-9]{2}-[0-9]{2}-[A-Za-z0-9._-]{1,120}'
const IN_RUNS = `runs/(${PLAN})/(${ROW})`
// «Ход — в runs/<plan>/T<n>.md» is the brief's task file line (skill lead, Brief).
const PROGRESS_LINE = new RegExp(`(?:Ход|Progress)\\s*[—–-]+\\s*(?:в|in)\\s[^\\n]*?${IN_RUNS}\\.md`)
const LOCK_FILE = new RegExp(`${IN_RUNS}\\.lock\\b`)
// Workers and sub-leads hold a row; a reviewer of T3 or the Lead itself does not.
const ROW_HOLDER_LABEL = /^\s*(?:W|SUB-?LEAD)\s*[·:|]/i

/** A worker or sub-lead brief, which should name its row (the CLI warns when it does not). */
export function hqBriefHoldsARow(text: string): boolean {
  const firstLine = text.split('\n').find((line) => line.trim().length > 0) ?? ''
  return ROW_HOLDER_LABEL.test(firstLine)
}

/** The plan row a Lead's brief starts a chat on; null for any other prompt. */
export function hqTaskOfBrief(text: string | undefined): HqTaskKey | null {
  if (!text) {
    return null
  }
  if (!hqBriefHoldsARow(text)) {
    return null
  }
  const match = PROGRESS_LINE.exec(text) ?? LOCK_FILE.exec(text)
  return match ? { plan: match[1], row: match[2] } : null
}

/** `--task <plan>:<row>` (`<plan>` a file name or path, with or without `.md`); null for `none`. */
export function parseHqTaskFlag(value: string): HqTaskKey | null {
  const trimmed = value.trim()
  if (trimmed.toLowerCase() === HQ_TASK_LOCK_NONE) {
    return null
  }
  const split = Math.max(trimmed.lastIndexOf(':'), trimmed.lastIndexOf('#'))
  const plan = hqTaskPlanName(split > 0 ? trimmed.slice(0, split) : '')
  const row = split > 0 ? trimmed.slice(split + 1).trim() : ''
  if (!plan || !new RegExp(`^${ROW}$`).test(row)) {
    throw new Error(
      `--task takes <plan>:<row>, e.g. 2026-11-28-refunds:T3, or none; got "${value}".`
    )
  }
  return { plan, row }
}

/** A plan's name as the lock keeps it: the file name in HQ/runs without its folder and `.md`. */
export function hqTaskPlanName(plan: string): string {
  const base = (plan.trim().split('/').pop() ?? '').trim()
  return base.endsWith('.md') ? base.slice(0, -'.md'.length) : base
}

export function hqTaskLabel(key: HqTaskKey): string {
  return `${key.row} of ${key.plan}`
}

function holderText(holder: HqTaskHolder): string {
  const state = holder.state ? `, ${holder.state}` : ''
  return `${holder.address ?? '(no address)'} (${holder.sessionId}${state})`
}

/** Why a launch was refused, with what to do instead. */
export function hqTaskRefusalText(
  key: HqTaskKey,
  refused: Extract<HqTaskClaimResult, { taken: false }>,
  now: number
): string {
  const skip = 'Pass --task none to start it anyway.'
  if (refused.reason === 'starting') {
    const ago = refused.since
      ? ` ${Math.max(0, Math.round((now - refused.since) / 1000))} s ago`
      : ''
    const from = refused.holder ? ` from ${holderText(refused.holder)}` : ''
    return `${hqTaskLabel(key)} is being started already (a launch${from} took it${ago}). Not started: wait for that chat. ${skip}`
  }
  const holder = refused.holder
  return [
    `${hqTaskLabel(key)} already runs in an open chat: ${holder ? holderText(holder) : 'unknown'}. Not started.`,
    holder
      ? `Message it (\`orca chat send ${holder.sessionId} "…"\`), or close it first and launch again.`
      : 'Close it first and launch again.',
    skip
  ].join(' ')
}
