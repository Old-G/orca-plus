// Custom build (hq-router, plan router T1 variant b, owner 26.11): replays the router bake-off cases
// through the router's own graph code on a COPY of orca-plus-pulse.db. Bindings are restored from the
// Approve history (our message → its Slack ts → the sending chat → its task); the owner's choice binds
// the thread as the cases go by. Jev's answers are the bake-off's recorded ones (jev-1.13, 20 chats).
// An answer counts when it lands in the owner's task or that task's Lead (or the reverse).
// Usage: node scripts/router-offline-eval.mjs <cases_v2.jsonl> --graph [--db <orca-plus-pulse.db>]
import { copyFileSync, existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { tsImport } from 'tsx/esm/api'

const args = process.argv.slice(2)
const casesPath = args.find((arg) => !arg.startsWith('--'))
if (!casesPath || !args.includes('--graph')) {
  throw new Error('usage: router-offline-eval.mjs <cases_v2.jsonl> --graph [--db <path>]')
}
const dbArg = args.indexOf('--db')
const source =
  dbArg !== -1
    ? args[dbArg + 1]
    : join(homedir(), 'Library/Application Support/orca-plus/orca-plus-pulse.db')
const JEV = 'typesafe/jev-1.13-20260917'

// The copy: never the live file. Old chats are `claude_<uuid with _>`, newer bare uuids; one spelling.
const copy = join(mkdtempSync(join(tmpdir(), 'router-eval-')), 'pulse.db')
copyFileSync(source, copy)
const norm = (id) =>
  typeof id === 'string' ? id.replace(/^(claude|codex)_/, '').replaceAll('_', '-') : id
{
  const raw = new DatabaseSync(copy)
  raw.function('norm', (value) => norm(value))
  for (const [table, cols] of Object.entries({
    sessions: ['session_id', 'parent_session_id'],
    journal: ['session_id', 'ref_id'],
    chat_roles: ['session_id'],
    chat_links: ['session_id', 'parent_session_id'],
    chat_lead_moves: ['session_id', 'to_session_id'],
    conversation_messages: ['session_id'],
    conversations: ['session_id'],
    waitings: ['agent_session_id']
  })) {
    for (const col of cols) {
      raw.exec(
        `UPDATE OR IGNORE ${table} SET ${col} = norm(${col}) WHERE ${col} LIKE 'c%\\_%' ESCAPE '\\'`
      )
    }
  }
  raw.exec('DROP TABLE IF EXISTS router_bindings; DROP TABLE IF EXISTS router_log')
  raw.close()
}

const here = dirname(new URL(import.meta.url).pathname)
const load = (path) => tsImport(join(here, '..', path), import.meta.url)
const { PulseCore } = await load('src/main/orca-plus/pulse/pulse-core.ts')
const graph = await load('src/main/orca-plus/pulse/pulse-router-graph.ts')
const { leadOfChat } = await load('src/main/orca-plus/pulse/pulse-router.ts')
const { hqRouterRefMatches } = await load('src/shared/hq-router.ts')
const core = new PulseCore(copy)
const q = (sql, ...params) => core.db.prepare(sql).all(...params)

// Restore the bindings from the Approve history.
let restored = 0
for (const row of q(
  "SELECT c.key, m.ts, m.at, m.session_id, m.decision_id FROM conversation_messages m JOIN conversations c ON c.id = m.conversation_id WHERE m.direction = 'out' AND m.decision_id IS NOT NULL AND c.key LIKE 'slack:%'"
)) {
  const [, channel, thread] = row.key.split(':')
  let sender = row.session_id
  if (!sender) {
    const d = q('SELECT context FROM decisions WHERE id = ?', row.decision_id)[0]
    sender = norm(JSON.parse(d?.context ?? '{}').agentSessionId ?? null)
  }
  if (sender && row.ts) {
    graph.bindSentMessage(core, {
      channel,
      ts: row.ts,
      threadTs: thread || null,
      sender,
      at: row.at
    })
    restored += 1
  }
}
for (const row of q(
  "SELECT decided_at AS at, json_extract(context, '$.targetId') AS ch, json_extract(context, '$.threadTs') AS th, json_extract(context, '$.agentSessionId') AS sid FROM decisions WHERE kind = 'approval' AND outcome IN ('approved', 'edited') AND json_extract(context, '$.service') LIKE 'slack' AND json_extract(context, '$.threadTs') IS NOT NULL"
)) {
  if (row.ch && row.sid) {
    // Why a synthetic ts: the history keeps the thread, not our message's own ts.
    graph.bindSentMessage(core, {
      channel: row.ch,
      ts: `approve:${row.at}`,
      threadTs: row.th,
      sender: norm(row.sid),
      at: row.at
    })
    restored += 1
  }
}

const task = (id) => (id && id !== 'new' ? graph.taskOfChat(core, id) : id)
const leadTask = (id) => {
  const lead = id && id !== 'new' ? leadOfChat(core, id) : null
  return lead ? task(lead) : null
}
const correct = (pick, gold) => {
  if (!pick || gold === 'new' || pick === 'new') {
    return pick === gold
  }
  const p = task(pick)
  const g = task(gold)
  return p === g || leadTask(p) === g || leadTask(g) === p
}

// The bake-off's person labels → names in the people table; kept beside the cases, not in this repo.
const aliasFile = join(dirname(casesPath), 'aliases.json')
const { aliases: ALIAS = {}, others: OTHERS = [] } = existsSync(aliasFile)
  ? JSON.parse(readFileSync(aliasFile, 'utf8'))
  : {}
const people = q('SELECT id, name FROM people')
const personIds = (keys) =>
  people
    .filter((p) => {
      const name = p.name.toLowerCase()
      return (
        keys.some((k) => name.startsWith(k)) &&
        !OTHERS.some((x) => name.includes(x) && !keys.includes(x))
      )
    })
    .map((p) => p.id)
const askingTasks = (ids, at) => {
  const out = []
  for (const w of q(
    `SELECT agent_session_id AS sid FROM waitings WHERE direction = 'on-them' AND agent_session_id IS NOT NULL AND created_at <= ? AND (resolved_at IS NULL OR resolved_at > ?) AND person_id IN (${ids.map(() => '?').join(',') || "''"}) ORDER BY created_at DESC`,
    at,
    at,
    ...ids
  )) {
    const t = graph.ownerTaskOf(core, w.sid)
    if (!out.includes(t)) {
      out.push(t)
    }
  }
  return out
}

const jev = new Map()
for (const line of readFileSync(join(dirname(casesPath), 'results_v2.jsonl'), 'utf8').split('\n')) {
  const r = line && JSON.parse(line)
  if (r?.model === JEV) {
    jev.set(r.case, [r.pick, ...(r.alts ?? [])].map(norm))
  }
}

const cases = readFileSync(casesPath, 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((l) => JSON.parse(l))
cases.sort((a, b) => a.at - b.at)
const tally = { n: 0, code: 0, codeOk: 0, top1: 0, top3: 0, sentWithoutYes: 0, noJev: 0, how: {} }
for (const c of cases) {
  const gold = norm(c.gold)
  const at = c.at
  const [, , channel, root] = c.set === 'A' ? c.id.split(':') : []
  const jevCard = (jev.get(c.id) ?? []).filter(Boolean)
  let card = null
  let how = 'model'
  let auto = false
  // Why the person's last message, not the owner's pick: our later replies are not what they answered.
  const lastIn = channel
    ? q(
        "SELECT MAX(m.at) AS at FROM conversation_messages m JOIN conversations c ON c.id = m.conversation_id WHERE c.key = ? AND m.direction = 'in' AND m.at <= ?",
        c.id.slice(2),
        at
      )[0]?.at
    : null
  const bound = channel
    ? graph.routerBindingFor(core, { channel, threadTs: root, linked: null, at: lastIn ?? at })
    : null
  if (bound) {
    how = bound.source === 'choice' ? 'thread' : 'crumb'
    auto = bound.source === 'choice'
    const lead = leadOfChat(core, bound.chat)
    card = [bound.chat, ...(lead ? [lead] : []), ...jevCard]
  } else {
    const keys = c.set === 'B' ? (ALIAS[c.person] ?? null) : null
    const asking = keys ? askingTasks(personIds(keys), at) : []
    const candidates = typeof c.candidates === 'string' ? [] : (c.candidates ?? [])
    const refs = hqRouterRefMatches(
      c.text ?? '',
      candidates.map((x) => ({
        sessionId: norm(x.id),
        title: x.name ?? '',
        taskRef: x.task_ref ?? null,
        lastReport: x.last_report ?? null,
        role: null,
        lastActivityAt: 0
      }))
    )
    if (asking.length === 1) {
      how = 'question'
      card = [asking[0], ...jevCard]
    } else if (refs.length > 0) {
      how = 'ref'
      card = [refs[0].chat.sessionId, ...jevCard]
    } else {
      card = jevCard
      if (card.length === 0) {
        tally.noJev += 1
      }
    }
  }
  const top3 = [...new Set(card)].slice(0, 3)
  const ok1 = correct(top3[0], gold)
  tally.n += 1
  tally.how[how] = (tally.how[how] ?? 0) + 1
  if (how !== 'model') {
    tally.code += 1
    tally.codeOk += ok1
  }
  tally.top1 += ok1
  if (process.env.DEBUG) {
    console.log(
      c.id,
      how,
      ok1,
      'gold',
      gold,
      task(gold),
      leadTask(task(gold)),
      'top',
      top3.map((x) => `${x}>${task(x)}`).join(' ')
    )
  }
  tally.top3 += top3.some((id) => correct(id, gold))
  // Sent without his yes: a route sent by itself that his own choice did not bind.
  tally.sentWithoutYes += auto && bound?.source !== 'choice'
  // The owner's choice on the card binds the thread for the cases after it.
  if (channel && gold !== 'new') {
    graph.bindChosenThread(core, { channel, threadTs: root, chat: gold, at })
  }
}
const pct = (a, b) => (b ? (a / b).toFixed(2) : 'n/a')
console.log(`bindings_restored ${restored}`)
console.log(
  `cases ${tally.n} by ${JSON.stringify(tally.how)}; without a recorded Jev answer ${tally.noJev}`
)
console.log(`code_share ${pct(tally.code, tally.n)}`)
console.log(`code_precision ${pct(tally.codeOk, tally.code)}`)
console.log(`top1_overall ${pct(tally.top1, tally.n)}`)
console.log(`top3_overall ${pct(tally.top3, tally.n)}`)
console.log(`sent_without_yes ${tally.sentWithoutYes}`)
core.close()
