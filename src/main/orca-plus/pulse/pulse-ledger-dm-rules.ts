// Custom build (hq-dm-default-project, owner 24.11): a person's DM with the owner has a project of its
// own, from HQ's routing.yaml (`intake.project` · `when: {dm: [...]}`). Stored as `dm:<slack user id>`
// rows of ledger_rules beside the channel rules the owner sets in HQ+.
import type { PulseCore } from './pulse-core'
import { noteConversationProjectGuess } from './pulse-attribution'

const DM_KEY = /^slack:(D[A-Z0-9]+):/
const DM_PLACE = 'dm:'

export type HqLedgerDmRule = { slackUserId: string; project: string }

/** Puts routing.yaml's DM rules in place of the stored ones; false when nothing changed. */
export function replaceLedgerDmRules(core: PulseCore, rules: readonly HqLedgerDmRule[]): boolean {
  const wanted = new Map(rules.map((rule) => [`${DM_PLACE}${rule.slackUserId}`, rule.project]))
  return core.transaction(() => {
    const stored = core.db
      .prepare(`SELECT place, project FROM ledger_rules WHERE place LIKE 'dm:%'`)
      .all()
    if (
      stored.length === wanted.size &&
      stored.every((row) => wanted.get(String(row.place)) === String(row.project))
    ) {
      return false
    }
    core.db.prepare(`DELETE FROM ledger_rules WHERE place LIKE 'dm:%'`).run()
    const insert = core.db.prepare('INSERT INTO ledger_rules (place, project, at) VALUES (?, ?, ?)')
    for (const [place, project] of wanted) {
      insert.run(place, project, core.clock.now())
    }
    return true
  })
}

/** The DM's project rule: by the person who wrote in, else by the first person seen in that DM. */
export function ledgerDmRuleOf(
  core: PulseCore,
  signal: { key: string; authorId: string | null; fromOwner: boolean }
): string | null {
  const dm = DM_KEY.exec(signal.key)
  if (!dm) {
    return null
  }
  const person =
    !signal.fromOwner && signal.authorId
      ? signal.authorId
      : core.db
          .prepare(
            `SELECT m.author_id FROM conversation_messages m JOIN conversations c ON c.id = m.conversation_id
              WHERE c.key LIKE ? AND m.direction = 'in' AND m.author_id IS NOT NULL
              ORDER BY m.at LIMIT 1`
          )
          .get(`slack:${dm[1]}:%`)?.author_id
  if (person == null) {
    return null
  }
  const row = core.db
    .prepare('SELECT project FROM ledger_rules WHERE place = ?')
    .get(`${DM_PLACE}${String(person)}`)
  return row ? String(row.project) : null
}

/** The DM's rule for a message; the DM conversation it joins moves to it. Call inside a transaction. */
export function ledgerDmRuleIn(
  core: PulseCore,
  signal: { key: string; authorId: string | null; fromOwner: boolean },
  conversationId: string | null
): string | null {
  const rule = ledgerDmRuleOf(core, signal)
  if (rule && conversationId) {
    applyLedgerDmRule(core, conversationId, rule)
  }
  return rule
}

/** A DM conversation a reader, a reply or a sending chat put elsewhere moves to the DM's rule; the
 *  owner's own pick stays. */
function applyLedgerDmRule(core: PulseCore, conversationId: string, project: string): void {
  const row = core.db
    .prepare('SELECT key, project, project_how FROM conversations WHERE id = ?')
    .get(conversationId)
  if (
    !row ||
    !DM_KEY.test(String(row.key)) ||
    row.project_how === 'owner' ||
    (row.project === project && row.project_how === 'rule')
  ) {
    return
  }
  core.db
    .prepare(`UPDATE conversations SET project = ?, project_how = 'rule' WHERE id = ?`)
    .run(project, conversationId)
  noteConversationProjectGuess(core, conversationId)
}
