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
})
