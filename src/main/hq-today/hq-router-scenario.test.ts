// The router end to end on Orca+'s own records (Slack mocked by a recorded hook payload): a chat sends
// through Approve → the person answers in that thread → the card offers the chat → the owner's «Send»
// binds the thread → the next answer goes by itself → after a Lead change and a handoff it goes to the
// successor. Nobody is messaged.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { HqRouterChat } from '../../shared/hq-router'
import { PulseDb } from '../orca-plus/pulse/pulse-db'
import type { PulseCore } from '../orca-plus/pulse/pulse-core'
import { recordOutgoingSent } from '../orca-plus/outgoing-approval/outgoing-sent-recorder'
import { routeHqIntake, type HqRouterDeps } from './hq-router'
import type { HqIntakeDraft } from './hq-slack-intake-suggest'

const FIXTURES = join(
  __dirname,
  '../orca-plus/outgoing-approval/__fixtures__/outgoing-sent-hooks.jsonl'
)
const hook = (name: string): Record<string, unknown> =>
  readFileSync(FIXTURES, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { case: string; payload: Record<string, unknown> })
    .find((entry) => entry.case === name)!.payload

const open: PulseDb[] = []
afterEach(() => {
  for (const db of open.splice(0)) {
    db.close()
  }
})
const NOW = 1_792_700_000_000
const core = (db: PulseDb): PulseCore => Reflect.get(db, 'core') as PulseCore
const chat = (id: string, role: HqRouterChat['role'] = 'worker'): HqRouterChat => ({
  sessionId: id,
  title: `Chat ${id}`,
  project: 'acme',
  repoId: 'repo',
  role,
  leadId: null,
  taskRef: null,
  lastReport: null,
  waitsOnAuthor: [],
  lastActivityAt: NOW - 1_000
})

describe('router scenario (Slack mocked)', () => {
  it('Approve → answer → card → Send binds → by itself → successor after Lead change and handoff', async () => {
    const db = new PulseDb(':memory:')
    open.push(db)
    const sql = (text: string, ...args: unknown[]) =>
      core(db)
        .db.prepare(text)
        .run(...(args as never[]))
    sql(
      "INSERT INTO chat_roles (session_id, role, at) VALUES ('W1', 'worker', 1), ('L1', 'lead', 1), ('L2', 'lead', 1)"
    )
    sql(
      "INSERT INTO chat_links (session_id, parent_session_id, via, at) VALUES ('W1', 'L1', 'launch', 1)"
    )

    // 1. The worker's message goes out through Approve; its Slack ts binds to the worker's task.
    const deps = {
      db: () => db,
      repoOfCwd: async () => 'acme/app',
      projectOf: async () => 'app',
      now: () => NOW
    }
    expect(
      await recordOutgoingSent(deps, { hook: hook('slack-dm-by-user-id'), agentSessionId: 'W1' })
    ).toBe(true)
    const [conversation] = db.listLedgerConversations()
    const [, channel, threadTs] = conversation.key.split(':')

    let chats = [chat('W1'), chat('L1', 'lead'), chat('other')]
    const router = db.router
    const route = (at: number) => {
      const draft: HqIntakeDraft = {
        channel,
        ts: String(at / 1000),
        threadTs,
        author: 'Ann',
        authorSlackId: 'U1',
        venue: 'dm',
        text: 'Done',
        links: [],
        files: [],
        permalink: null,
        at
      }
      const routerDeps: HqRouterDeps = {
        chats: () => chats,
        binding: (lookup) => router.binding(lookup),
        leadOf: (id) => router.leadOf(id),
        crumb: (lookup) => router.crumb(lookup),
        boundChat: (key) => router.boundChat(key),
        history: () => [],
        waitsOn: () => new Map(),
        jev: null,
        fallback: async () => ({ ok: false, error: 'off' }),
        now: () => at
      }
      return routeHqIntake(draft, routerDeps)
    }

    // 2. The answer in that thread: the card offers the worker, its Lead next; nothing goes by itself.
    const first = await route(NOW + 60_000)
    expect(first).toMatchObject({ target: 'W1', how: 'crumb', auto: false })
    expect(first.alternatives[0].sessionId).toBe('L1')

    // 3. The owner presses «Send»: the thread binds to the task.
    router.bindChoice({ channel, threadTs, chat: 'W1', at: NOW + 70_000 })
    expect(await route(NOW + 80_000)).toMatchObject({ target: 'W1', how: 'thread', auto: true })

    // 4. The Lead changes and the worker hands off: the answer goes to the successor, Lead L2.
    sql(
      "INSERT INTO chat_lead_moves (chat, from_lead, to_lead, session_id, to_session_id, at) VALUES ('w', 'L1', 'L2', 'W1', 'L2', ?)",
      NOW + 90_000
    )
    sql(
      `INSERT INTO journal (id, at, workspace, kind, session_id, title, needs, ref_kind, ref_id, source)
       VALUES ('h1', ?, 'w', 'session.handoff', 'W2', 'Handoff', 'nobody', 'session', 'W1', 'test')`,
      NOW + 95_000
    )
    chats = [chat('W2'), chat('L2', 'lead'), chat('other')]
    expect(await route(NOW + 100_000)).toMatchObject({ target: 'W2', how: 'thread', auto: true })
    expect(router.leadOf('W2')).toBe('L2')
  })

  it('a one-off chat sends for the work the owner picked; answers follow that work, then its Lead', async () => {
    const db = new PulseDb(':memory:')
    open.push(db)
    const sql = (text: string, ...args: unknown[]) =>
      core(db)
        .db.prepare(text)
        .run(...(args as never[]))
    sql(
      "INSERT INTO chat_roles (session_id, role, at) VALUES ('W1', 'worker', 1), ('L1', 'lead', 1)"
    )
    sql(
      "INSERT INTO chat_links (session_id, parent_session_id, via, at) VALUES ('W1', 'L1', 'launch', 1)"
    )
    for (const id of ['ask', 'W1', 'W2', 'L1']) {
      sql(
        "INSERT INTO sessions (session_id, workspace, state, opened_at, last_activity_at) VALUES (?, 'w', 'working', 1, 1)",
        id
      )
    }
    // `ask` has no role and no parent: Orca+ knows no work of its own.
    expect(db.router.senderWork('ask')).toEqual({ work: 'ask', known: false })

    // 1. The owner picked W1's work on the Approve card of `ask`'s message.
    const payload = hook('slack-dm-by-user-id')
    sql(
      "INSERT INTO drafts (id, kind, body, source, fingerprint, status, created_at, updated_at) VALUES ('d1', 'message', 'x', 'gate', ?, 'approved', 1, 1)",
      `gate:${String(payload.session_id)}:${String(payload.tool_use_id)}`
    )
    sql(
      "INSERT INTO decisions (id, kind, title, outcome, draft_id, source, decided_at, context) VALUES ('a1', 'approval', 't', 'approved', 'd1', 'gate', ?, ?)",
      NOW,
      JSON.stringify({ agentSessionId: 'ask', workId: 'W1' })
    )
    const deps = {
      db: () => db,
      repoOfCwd: async () => 'acme/app',
      projectOf: async () => 'app',
      now: () => NOW
    }
    expect(await recordOutgoingSent(deps, { hook: payload, agentSessionId: 'ask' })).toBe(true)
    const [conversation] = db.listLedgerConversations()
    const [, channel, threadTs] = conversation.key.split(':')
    const bound = core(db).db.prepare('SELECT task, chat FROM router_bindings').all()
    expect(bound).toEqual([{ task: 'W1', chat: 'ask' }])

    let chats = [chat('W1'), chat('L1', 'lead'), chat('ask', null)]
    const router = db.router
    const route = (at: number) =>
      routeHqIntake(
        {
          channel,
          ts: String(at / 1000),
          threadTs,
          author: 'Ann',
          authorSlackId: 'U1',
          venue: 'dm',
          text: 'Done',
          links: [],
          files: [],
          permalink: null,
          at
        },
        {
          chats: () => chats,
          binding: (lookup) => router.binding(lookup),
          workTarget: (work) => router.workTarget(work),
          leadOf: (id) => router.leadOf(id),
          crumb: (lookup) => router.crumb(lookup),
          boundChat: (key) => router.boundChat(key),
          history: () => [],
          waitsOn: () => new Map(),
          jev: null,
          fallback: async () => ({ ok: false, error: 'off' }),
          now: () => at
        }
      )

    // 2. The answer goes to the work's chat, not to the one-off chat that asked.
    expect(await route(NOW + 60_000)).toMatchObject({ target: 'W1', how: 'crumb', auto: false })

    // 3. W1 hands off to W2: the work's chat now.
    sql(
      `INSERT INTO journal (id, at, workspace, kind, session_id, title, needs, ref_kind, ref_id, source)
       VALUES ('h1', ?, 'w', 'session.handoff', 'W2', 'Handoff', 'nobody', 'session', 'W1', 'test')`,
      NOW + 70_000
    )
    chats = [chat('W2'), chat('L1', 'lead'), chat('ask', null)]
    expect(await route(NOW + 80_000)).toMatchObject({ target: 'W2', how: 'crumb' })

    // 4. W2 closes: the work's Lead.
    sql("UPDATE sessions SET state = 'closed', closed_at = ? WHERE session_id = 'W2'", NOW + 85_000)
    chats = [chat('L1', 'lead'), chat('ask', null)]
    const closed = await route(NOW + 90_000)
    expect(closed).toMatchObject({ target: 'L1', how: 'crumb', level: 'lead' })
    expect(closed.why).toBe('Breadcrumb: the work is closed; its Lead «Chat L1»')

    // 5. The Lead closes too: no crumb; the card asks the owner.
    sql("UPDATE sessions SET state = 'closed', closed_at = ? WHERE session_id = 'L1'", NOW + 95_000)
    chats = [chat('ask', null)]
    expect((await route(NOW + 100_000)).how).not.toBe('crumb')
  })
})
