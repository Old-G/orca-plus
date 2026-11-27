// Custom build (hq-router T0, owner 28.11): how each routed card ended — sent, sent by itself, pasted into a
// chat, skipped, gone — kept in router_log beside what the router offered, and the per-class counts
// `orca hq router-stats` prints from it. T4 reads these to decide which class may send by itself.
import type { RouterClassStats } from '../../../shared/hq-router-stats'
import type { PulseCore } from './pulse-core'
import { taskOfTarget } from './pulse-router-graph'

export type RouterOutcome = 'sent' | 'auto' | 'paste' | 'skipped' | 'gone'

/**
 * How a card ended, once: sent / auto / paste take a chat (chosen); skipped and gone take a reason.
 * A card that ends «sent» to a chat other than the offered one reads «other».
 */
export function logOutcome(
  core: PulseCore,
  key: string,
  input: { outcome: RouterOutcome; at: number; chosen?: string | null; reason?: string | null }
): void {
  const row = core.db.prepare('SELECT target, outcome FROM router_log WHERE key = ?').get(key) as
    | { target: string; outcome: string | null }
    | undefined
  if (!row || row.outcome) {
    return
  }
  const chosen = input.chosen ?? null
  const outcome =
    input.outcome === 'sent' && chosen !== null && chosen !== row.target ? 'other' : input.outcome
  core.db
    .prepare(
      'UPDATE router_log SET outcome = ?, outcome_at = ?, reason = COALESCE(?, reason), chosen = COALESCE(chosen, ?), ' +
        'chosen_at = CASE WHEN chosen IS NULL AND ? IS NOT NULL THEN ? ELSE chosen_at END, ' +
        'chosen_task = COALESCE(chosen_task, ?) WHERE key = ? AND outcome IS NULL'
    )
    .run(
      outcome,
      input.at,
      input.reason ?? null,
      chosen,
      chosen,
      input.at,
      chosen ? taskOfTarget(core, chosen) : null,
      key
    )
}

const WEEK_MS = 7 * 24 * 60 * 60_000

/**
 * T0: the cards the router routed that closed without the owner's choice (the bell's `gone` when a poll
 * stopped reporting the mark, a settled auto-send, a skip) — read from the bell, so every way a card
 * ends leaves an outcome. A row whose card never appears and is older than a week is `gone`.
 */
export function reconcileRouterOutcomes(core: PulseCore, now: number): number {
  // Why: a row made before outcomes has its choice but no outcome.
  core.db
    .prepare(
      "UPDATE router_log SET outcome = CASE WHEN chosen = target THEN 'sent' ELSE 'other' END, " +
        'outcome_at = chosen_at WHERE outcome IS NULL AND chosen IS NOT NULL'
    )
    .run()
  const open = core.db
    .prepare('SELECT key, at, target FROM router_log WHERE outcome IS NULL AND at > ?')
    .all(now - 30 * 24 * 60 * 60_000) as { key: string; at: number; target: string }[]
  let settled = 0
  for (const row of open) {
    const rest = row.key.replace(/^slack:/, '')
    const item = core.db
      .prepare(
        'SELECT created_at, done_at, done_action FROM inbox WHERE dedupe_key IN (?, ?) OR dedupe_key LIKE ? ORDER BY created_at DESC LIMIT 1'
      )
      .get(
        `hq-intake:${rest}`,
        `router:${rest}`,
        `hq-intake:conv:%:${rest.slice(rest.lastIndexOf(':') + 1)}`
      ) as { created_at: number; done_at: number | null; done_action: string | null } | undefined
    if (!item) {
      if (now - row.at > WEEK_MS + 24 * 60 * 60_000) {
        logOutcome(core, row.key, { outcome: 'gone', at: now, reason: 'card-missing' })
        settled += 1
      }
      continue
    }
    if (item.done_at === null) {
      continue
    }
    const at = item.done_at
    if (item.done_action === 'gone') {
      const expired = at - item.created_at >= WEEK_MS - 60 * 60_000
      logOutcome(core, row.key, {
        outcome: 'gone',
        at,
        reason: expired ? 'expired-after-a-week' : 'mark-removed-or-message-gone'
      })
    } else if (item.done_action === 'sent') {
      // Why: «sent» with no choice logged is the settle of a thread sent by itself.
      logOutcome(core, row.key, { outcome: 'auto', at, chosen: row.target })
    } else {
      logOutcome(core, row.key, { outcome: 'skipped', at, reason: item.done_action ?? 'closed' })
    }
    settled += 1
  }
  return settled
}

/** Per route class, what became of the cards routed since a moment. */
export function routerStats(core: PulseCore, since: number): RouterClassStats[] {
  const rows = core.db
    .prepare(
      'SELECT how, target, top, outcome, chosen, target_task, chosen_task FROM router_log WHERE at >= ?'
    )
    .all(since) as {
    how: string
    target: string
    top: string
    outcome: string | null
    chosen: string | null
    target_task: string | null
    chosen_task: string | null
  }[]
  const byHow = new Map<string, RouterClassStats>()
  for (const row of rows) {
    const stats =
      byHow.get(row.how) ??
      ({
        how: row.how,
        n: 0,
        chatRight: 0,
        workRight: 0,
        top3: 0,
        skipped: 0,
        gone: 0,
        open: 0,
        share: 0
      } satisfies RouterClassStats)
    byHow.set(row.how, stats)
    if (row.outcome === 'skipped') {
      stats.skipped += 1
    } else if (row.outcome === 'gone') {
      stats.gone += 1
    } else if (!row.outcome) {
      stats.open += 1
    } else if (!row.chosen) {
      // Why: closed «sent» with no chat to compare — nothing to be right or wrong about.
      stats.skipped += 1
    } else {
      stats.n += 1
      const chat = row.chosen === row.target
      stats.chatRight += chat ? 1 : 0
      stats.workRight += chat || (!!row.target_task && row.target_task === row.chosen_task) ? 1 : 0
      let top: unknown = []
      try {
        top = JSON.parse(row.top)
      } catch {
        top = []
      }
      stats.top3 += Array.isArray(top) && top.includes(row.chosen) ? 1 : 0
    }
  }
  const total = [...byHow.values()].reduce((sum, entry) => sum + entry.n, 0)
  return [...byHow.values()]
    .map((entry) => ({ ...entry, share: total > 0 ? entry.n / total : 0 }))
    .sort((a, b) => b.n - a.n || a.how.localeCompare(b.how))
}

/**
 * Router v2 T4: per auto class, the cards decided since a moment — the owner sent, pasted or picked
 * another chat, or the class sent it by itself — and how many went to the offered chat. A card sent by
 * itself counts as right: nothing marks it wrong until T5's «Не туда», and without it a class that went
 * auto would drop out once the owner's own decisions left the window.
 */
export function routerAutoRecords(
  core: PulseCore,
  since: number
): Map<string, { n: number; right: number }> {
  const rows = core.db
    .prepare(
      'SELECT auto_class, COUNT(*) AS n, SUM(CASE WHEN chosen = target THEN 1 ELSE 0 END) AS right ' +
        "FROM router_log WHERE at >= ? AND auto_class IS NOT NULL AND chosen IS NOT NULL AND outcome IN ('sent', 'other', 'paste', 'auto') " +
        'GROUP BY auto_class'
    )
    .all(since) as { auto_class: string; n: number; right: number | null }[]
  return new Map(rows.map((row) => [row.auto_class, { n: row.n, right: row.right ?? 0 }]))
}

/**
 * Router v2 T5: where a card the router sent by itself really belongs — the chat it went to (send first),
 * the runner-up after «не моё», the chat the owner picked with «Wrong chat». Unlike logOutcome it rewrites
 * an outcome already written, but only on an auto row: «auto» when it is the offered chat, else «other».
 */
export function rewriteAutoOutcome(
  core: PulseCore,
  key: string,
  input: { chosen: string; at: number; reason: string }
): void {
  core.db
    .prepare(
      "UPDATE router_log SET outcome = CASE WHEN target = ? THEN 'auto' ELSE 'other' END, outcome_at = ?, " +
        'reason = ?, chosen = ?, chosen_at = ?, chosen_task = ? WHERE key = ? AND auto = 1'
    )
    .run(
      input.chosen,
      input.at,
      input.reason,
      input.chosen,
      input.at,
      taskOfTarget(core, input.chosen),
      key
    )
}

/**
 * Router v2 T5: a send-first card back with the owner after two «не моё» (or no chat left to try) — the
 * row is open again, so his «Send» writes the outcome; the reason stays until then.
 */
export function reopenAutoOutcome(core: PulseCore, key: string, reason: string): void {
  core.db
    .prepare(
      'UPDATE router_log SET outcome = NULL, outcome_at = NULL, chosen = NULL, chosen_at = NULL, ' +
        'chosen_task = NULL, reason = ? WHERE key = ? AND auto = 1'
    )
    .run(reason, key)
}

/** Router v2 T5: the send-first did not go (the chat could not take it) — the card waits as before. */
export function unmarkAutoRoute(core: PulseCore, key: string): void {
  core.db.prepare('UPDATE router_log SET auto = 0 WHERE key = ? AND outcome IS NULL').run(key)
}

/** Where the owner sent the card in the end. */
export function logChoice(core: PulseCore, key: string, chosen: string, at: number): void {
  core.db
    .prepare('UPDATE router_log SET chosen = ?, chosen_at = ? WHERE key = ? AND chosen IS NULL')
    .run(chosen, at, key)
  // T0: «sent» when it went where the router offered, «other» when the owner picked another chat.
  logOutcome(core, key, { outcome: 'sent', chosen, at })
}
