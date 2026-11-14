// Custom build (chat-auto-effort-roles): the effort route on a labelled set of real chat messages.
// The set lives outside the repo (private messages): ORCA_EFFORT_EVAL_DIR names a folder with
// set.jsonl (sessionId, text, recorded Jev pick, its result) and labels.json ({id: {label}}), and
// ORCA_EFFORT_EVAL_HQ the HQ folder whose runs/*.md name the lead chats. Without them it is skipped.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { AgentSessionRecord } from '../../../shared/agent-session/lifecycle/agent-session-record'
import { effortRoute } from './chat-role-effort'
import { createChatRoleOf } from './lead-plan-registry'

const dir = process.env.ORCA_EFFORT_EVAL_DIR
const hq = process.env.ORCA_EFFORT_EVAL_HQ
// Plan check (14.11): roles and relays right on at least 95%; on the owner's own messages the route
// matches the labels no worse than Jev alone did before roles.
const ROLES_PASS = 0.95

type Row = {
  id: string
  stratum: 'lead' | 'relayed' | 'owner'
  sessionId: string
  text: string
  recorded: string
  result: string
}

describe.skipIf(!dir || !hq)('effort route on the labelled set', () => {
  it(`gets roles and relays right on ${ROLES_PASS * 100}%, and Jev no worse than before`, async () => {
    const rows = readFileSync(join(dir!, 'set.jsonl'), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Row)
    const labels = JSON.parse(readFileSync(join(dir!, 'labels.json'), 'utf8')) as Record<
      string,
      { label: string }
    >
    const roleOf = createChatRoleOf({ hqPath: () => hq })
    const misses: string[] = []
    const roles = { hit: 0, all: 0 }
    const owner = { now: 0, before: 0, all: 0 }
    for (const row of rows) {
      const role = await roleOf({ sessionId: row.sessionId } as AgentSessionRecord)
      const route = effortRoute({ role, fromPerson: true, text: row.text })
      // Why: the recorded Jev pick stands in for a live call; before roles, every message got it.
      const jev = row.result === 'picked' ? row.recorded : 'keep'
      const answer = route.kind === 'fixed' ? route.effort : route.kind === 'relayed' ? 'keep' : jev
      const label = labels[row.id]?.label
      const hit = answer === label
      if (row.stratum !== 'owner' || label === 'keep') {
        roles.all += 1
        roles.hit += hit ? 1 : 0
      } else {
        owner.all += 1
        owner.now += hit ? 1 : 0
        owner.before += jev === label ? 1 : 0
      }
      if (!hit) {
        misses.push(`${row.id} ${route.kind}: ${answer} ≠ ${label} — ${row.text.slice(0, 60)}`)
      }
    }
    console.info(
      `[effort eval] roles and relays ${roles.hit}/${roles.all}; owner ${owner.now}/${owner.all} (Jev alone ${owner.before}/${owner.all}); all ${rows.length - misses.length}/${rows.length}\n${misses.join('\n')}`
    )
    expect(rows.length).toBe(40)
    expect(roles.hit / roles.all).toBeGreaterThanOrEqual(ROLES_PASS)
    expect(owner.now).toBeGreaterThanOrEqual(owner.before)
  })
})
