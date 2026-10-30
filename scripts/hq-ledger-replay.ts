// Custom build (hq-request-ledger): replays a week of what the readers saw — Slack mentions and
// marks, answers to waitings, scout requests, the owner's sent messages — through the ledger on a
// COPY of orca-plus-pulse.db, and prints how many cards became how many conversations.
// Usage: node_modules/.bin/tsx scripts/hq-ledger-replay.ts <copy.db> [days=7] [--json out.json]
import { writeFileSync } from 'node:fs'
import Database from '../src/main/sqlite/sync-database'
import { PulseDb } from '../src/main/orca-plus/pulse/pulse-db'
import { hqPlaceKey, type HqLedgerSignal } from '../src/shared/hq-ledger'

const [path, daysArg, flag, jsonOut] = process.argv.slice(2)
if (!path) {
  throw new Error('usage: hq-ledger-replay.ts <copy.db> [days] [--json out.json]')
}
const days = Number(daysArg ?? 7)
const pulse = new PulseDb(path) // migrates the copy to the ledger's schema
const raw = new Database(path)
const since = Date.now() - days * 86_400_000
raw.exec(
  'DELETE FROM conversation_messages; DELETE FROM conversations; UPDATE waitings SET conversation_id = NULL'
)

type Item = { at: number; card: string; signal: HqLedgerSignal | null }
const items: Item[] = []
const json = (text: unknown): Record<string, unknown> | null => {
  try {
    const parsed = JSON.parse(String(text))
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}
const str = (value: unknown): string | null => (typeof value === 'string' && value ? value : null)

for (const row of raw
  .prepare(
    `SELECT kind, ref_id, created_at, title FROM inbox
      WHERE created_at > ? AND kind IN ('hq-intake','hq-waiting-reply','slack-request')`
  )
  .all(since)) {
  const at = Number(row.created_at)
  const ref = json(row.ref_id)
  const card = String(row.kind)
  let signal: HqLedgerSignal | null = null
  if (card === 'hq-intake' && ref) {
    const channel = str(ref.channel)
    const ts = str(ref.ts)
    if (channel && ts) {
      signal = {
        key: `slack:${channel}:${str(ref.threadTs) ?? ts}`,
        ts,
        at,
        author: str(ref.author),
        authorId: str(ref.authorSlackId),
        fromOwner: false,
        text: str(ref.text) ?? '',
        link: str(ref.permalink),
        reader: 'slack-mention',
        forOwner: true,
        project: str(ref.project),
        title: str(ref.summary) ?? String(row.title)
      }
    }
  } else if (card === 'hq-waiting-reply' && ref) {
    const waiting = raw
      .prepare('SELECT source_ref, person_id FROM waitings WHERE id = ?')
      .get(str(ref.waitingId))
    const person = waiting?.person_id
      ? raw
          .prepare('SELECT slack_user_id, clickup_user_id FROM people WHERE id = ?')
          .get(waiting.person_id)
      : null
    const key = hqPlaceKey(str(ref.link)) ?? hqPlaceKey(waiting ? str(waiting.source_ref) : null)
    if (key) {
      signal = {
        key,
        ts: str(ref.replyTs) ?? String(at),
        at,
        author: str(ref.author),
        authorId: person ? (str(person.slack_user_id) ?? str(person.clickup_user_id)) : null,
        fromOwner: false,
        text: str(ref.reply) ?? '',
        link: str(ref.link),
        reader: 'reply',
        forOwner: true,
        project: str(ref.project),
        title: str(ref.question) ?? String(row.title)
      }
    }
  } else if (card === 'slack-request' && ref) {
    const id = str(ref.id) ?? ''
    const [channel, thread] = id.split(':')
    const key = /^[CDG][A-Z0-9]{6,}$/.test(channel ?? '')
      ? `slack:${channel}:${thread}`
      : (hqPlaceKey(str(ref.link)) ??
        (id.startsWith('clickup') ? `clickup:${id.split(':')[1]}` : null))
    if (key) {
      signal = {
        key,
        ts: `req:${id}`,
        at,
        author: null,
        authorId: null,
        fromOwner: false,
        text: String(row.title),
        link: str(ref.link),
        reader: 'scout',
        forOwner: ref.kind !== 'fyi',
        project: null,
        title: String(row.title)
      }
    }
  }
  items.push({ at, card, signal })
}
for (const row of raw
  .prepare(
    `SELECT source_ref, created_at, title FROM waitings WHERE direction = 'on-me' AND created_at > ?`
  )
  .all(since)) {
  items.push({ at: Number(row.created_at), card: 'promise', signal: null })
}
for (const row of raw
  .prepare(
    `SELECT id, body, context, decided_at FROM decisions WHERE decided_at > ? AND context IS NOT NULL`
  )
  .all(since)) {
  const context = json(row.context)
  const channel = context ? str(context.targetId) : null
  const thread = context ? str(context.threadTs) : null
  if (channel && thread && /^[CDG]/.test(channel)) {
    const at = Number(row.decided_at)
    items.push({
      at,
      card: '',
      signal: {
        key: `slack:${channel}:${thread}`,
        ts: `sent:${String(row.id)}`,
        at,
        author: 'owner',
        authorId: null,
        fromOwner: true,
        text: String(row.body ?? ''),
        link: null,
        reader: 'approve',
        forOwner: false,
        project: null,
        title: String(row.body ?? '').slice(0, 80)
      }
    })
  }
}
items.sort((a, b) => a.at - b.at)

// Why: the ledger looks at waitings open at the time — replay each moment with the statuses it had.
const reopen = raw.prepare(
  `UPDATE waitings SET status = CASE WHEN created_at <= ? AND (resolved_at IS NULL OR resolved_at > ?)
     THEN 'open' ELSE 'resolved' END`
)
const steps: Record<string, number> = {}
const links: { at: number; step: string; author: string | null; text: string; to: string[] }[] = []
let cards = 0
let unkeyed = 0
for (const item of items) {
  if (item.card) {
    cards += 1
  }
  if (!item.signal) {
    unkeyed += item.card === 'promise' ? 0 : 1
    continue
  }
  reopen.run(item.at, item.at)
  const result = pulse.ingestLedgerSignal(item.signal)
  steps[result.step] = (steps[result.step] ?? 0) + 1
  if (result.step !== 'new' && result.step !== 'owner' && !item.signal.fromOwner) {
    const titles = result.waitingIds.map((id) =>
      String(raw.prepare('SELECT title FROM waitings WHERE id = ?').get(id)?.title ?? id)
    )
    links.push({
      at: item.at,
      step: result.step,
      author: item.signal.author,
      text: item.signal.text.replace(/\s+/g, ' ').slice(0, 160),
      to: titles
    })
  }
}
const conversations = pulse.listLedgerConversations(since)
const report = {
  days,
  cards,
  unkeyed,
  conversations: conversations.length,
  byState: conversations.reduce<Record<string, number>>(
    (acc, c) => ({ ...acc, [c.state]: (acc[c.state] ?? 0) + 1 }),
    {}
  ),
  steps,
  which: links.filter((l) => l.step === 'which').length,
  links
}
console.log(JSON.stringify({ ...report, links: links.length }, null, 2))
if (flag === '--json' && jsonOut) {
  writeFileSync(jsonOut, JSON.stringify(report, null, 2))
}
