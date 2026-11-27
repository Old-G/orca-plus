import { afterEach, describe, expect, it } from 'vitest'
import type { HqRoute } from '../../shared/hq-router'
import { hqRouteNewMark } from '../../shared/hq-router'
import { hqIntakeBellItem, type HqIntake } from '../../shared/hq-slack-intake'
import type { PulseBellInput } from '../../shared/pulse-bell'
import { PulseCore } from '../orca-plus/pulse/pulse-core'
import {
  logChoice,
  reopenAutoOutcome,
  rewriteAutoOutcome,
  routerAutoRecords,
  unmarkAutoRoute
} from '../orca-plus/pulse/pulse-router-outcomes'
import { logRoute } from '../orca-plus/pulse/pulse-router-graph'
import { hqIntakeWrongChat, hqRouterLogKey } from './hq-intake-close-route'
import { gateAndLogRoute, withSendFirst } from './hq-router-auto-gate'
import {
  followNotMine,
  sendFirstCard,
  type HqRouterFinishedTurn,
  type HqRouterSendFirstDeps
} from './hq-router-send-first'
import { pollHqSlackIntake, type HqSlackIntakeDeps } from './hq-slack-intake'
import type { HqIntakeDraft } from './hq-slack-intake-suggest'

const NOW = Date.UTC(2026, 10, 28, 9)
const open: PulseCore[] = []
afterEach(() => {
  for (const c of open.splice(0)) {
    c.close()
  }
})
function core(): PulseCore {
  const c = new PulseCore(':memory:', { now: () => NOW, newId: () => 'x' })
  open.push(c)
  return c
}

const route = (extra: Partial<HqRoute> = {}): HqRoute => ({
  target: 'a',
  targetTitle: 'A',
  repoId: null,
  project: null,
  level: 'worker',
  how: 'model',
  why: 'Jev picked it',
  auto: false,
  alternatives: [
    { sessionId: 'b', title: 'B', repoId: null },
    { sessionId: 'c', title: 'C', repoId: null }
  ],
  confidence: 0.6,
  model: 'Jev',
  ...extra
})

function draft(ts: string, extra: Partial<HqIntakeDraft> = {}): HqIntakeDraft {
  return {
    channel: 'C0AAAAAAAAA',
    ts,
    threadTs: null,
    author: 'Ann',
    authorSlackId: 'U1',
    venue: 'channel',
    text: 'Please fix the export',
    links: [],
    files: [],
    permalink: null,
    at: NOW - 60_000,
    ...extra
  }
}

const card = (extra: Partial<HqIntake> = {}): HqIntake => ({
  ...draft('1795000000.000100'),
  repoId: null,
  project: null,
  summary: 'Fix the export',
  route: route({ sendFirst: true }),
  ...extra
})

type Row = { auto: number; outcome: string | null; chosen: string | null; reason: string | null }
const row = (c: PulseCore, key: string): Row =>
  c.db.prepare('SELECT auto, outcome, chosen, reason FROM router_log WHERE key = ?').get(key) as Row

/** The middle zone wired to a real router log; `turns` are the chats' finished turns. */
function wired(c: PulseCore, turns: HqRouterFinishedTurn[] = [], refuse = new Set<string>()) {
  const sent: { chat: string; card: HqIntake }[] = []
  let now = NOW
  const deps: HqRouterSendFirstDeps = {
    deliver: async (chat, intake) => {
      if (refuse.has(chat)) {
        return false
      }
      sent.push({ chat, card: intake })
      return true
    },
    finishedTurns: (since) => turns.filter((turn) => turn.at >= since),
    rewriteOutcome: (key, input) => rewriteAutoOutcome(c, key, input),
    reopenOutcome: (key, reason) => reopenAutoOutcome(c, key, reason),
    unmarkAuto: (key) => unmarkAutoRoute(c, key),
    now: () => now
  }
  return { deps, sent, tick: (ms: number) => (now += ms) }
}

const KEY = hqRouterLogKey(card())
const logged = (c: PulseCore, done: HqRoute): HqRoute =>
  gateAndLogRoute(
    done,
    {
      mark: true,
      settings: {},
      router: {
        autoRecords: (since) => routerAutoRecords(c, since),
        logRoute: (entry) => logRoute(c, entry)
      },
      key: KEY
    },
    NOW
  )

describe('router v2 T5: the middle zone', () => {
  it('a 👾 the gate did not let go is send-first, its row auto=1; 🆕, «new», a paste and the setting off are not', () => {
    const c = core()
    const done = logged(c, route({ how: 'question', autoClass: 'question' }))
    expect(done).toMatchObject({ auto: false, sendFirst: true })
    expect(row(c, KEY).auto).toBe(1)
    expect(withSendFirst(route(), true, {}).sendFirst).toBe(true)
    expect(withSendFirst(route({ target: 'new' }), true, {}).sendFirst).toBeUndefined()
    expect(withSendFirst(hqRouteNewMark(), true, {}).sendFirst).toBeUndefined()
    expect(withSendFirst(route(), false, {}).sendFirst).toBeUndefined()
    expect(withSendFirst(route(), true, { hqRouterSendFirst: false }).sendFirst).toBeUndefined()
    expect(withSendFirst(route({ auto: true }), true, {}).sendFirst).toBeUndefined()
  })

  it('sends to №1 with «check first» and writes outcome auto; a chat that cannot take it leaves the card waiting', async () => {
    const c = core()
    logged(c, route())
    const { deps, sent } = wired(c)
    const out = await sendFirstCard(card(), deps)
    expect(sent.map((s) => s.chat)).toEqual(['a'])
    expect(out.sent).toEqual({ chat: 'a', title: 'A', at: NOW })
    expect(row(c, KEY)).toMatchObject({
      auto: 1,
      outcome: 'auto',
      chosen: 'a',
      reason: 'send-first'
    })

    const c2 = core()
    logged(c2, route())
    const failed = await sendFirstCard(card(), wired(c2, [], new Set(['a'])).deps)
    expect(failed.sent).toBeUndefined()
    expect(failed.route?.sendFirst).toBe(false)
    expect(row(c2, KEY)).toMatchObject({ auto: 0, outcome: null })
  })

  it('«не моё» from №1 passes it to №2 and rewrites the outcome; a second «не моё» gives the card back', async () => {
    const c = core()
    logged(c, route())
    const turns: HqRouterFinishedTurn[] = []
    const { deps, sent, tick } = wired(c, turns)
    let current = await sendFirstCard(card(), deps)
    // The chat's own turn that ended after the send, and an older «не моё», change nothing.
    turns.push({ chat: 'a', at: NOW - 1, text: 'не моё: old' })
    turns.push({ chat: 'a', at: NOW + 1_000, text: 'Done with the migration.' })
    expect((await followNotMine(new Map([['k', current]]), deps)).size).toBe(0)

    tick(60_000)
    turns.push({ chat: 'a', at: NOW + 30_000, text: 'не моё: это про биллинг, я в экспорте' })
    current = (await followNotMine(new Map([['k', current]]), deps)).get('k') as HqIntake
    expect(sent.map((s) => s.chat)).toEqual(['a', 'b'])
    expect(current.sent).toEqual({ chat: 'b', title: 'B', at: NOW + 60_000 })
    expect(current.notMine).toEqual([
      { chat: 'a', title: 'A', reason: 'это про биллинг, я в экспорте' }
    ])
    expect(row(c, KEY)).toMatchObject({ outcome: 'other', chosen: 'b', reason: 'not-mine' })

    turns.push({ chat: 'b', at: NOW + 90_000, text: 'Не моё — другой репо' })
    current = (await followNotMine(new Map([['k', current]]), deps)).get('k') as HqIntake
    expect(sent).toHaveLength(2)
    expect(current.sent).toBeUndefined()
    expect(current.notMine?.map((no) => no.chat)).toEqual(['a', 'b'])
    expect(row(c, KEY)).toMatchObject({ outcome: null, chosen: null, reason: 'not-mine-twice' })
    // The owner's «Send» on the card that came back writes the outcome as any card's.
    logChoice(c, KEY, 'c', NOW + 120_000)
    expect(row(c, KEY)).toMatchObject({ outcome: 'other', chosen: 'c', reason: 'not-mine-twice' })
  })

  it('with no runner-up left the first «не моё» gives the card back', async () => {
    const c = core()
    logged(c, route({ alternatives: [] }))
    const turns: HqRouterFinishedTurn[] = [{ chat: 'a', at: NOW + 5, text: 'не моё' }]
    const { deps, sent } = wired(c, turns)
    const first = await sendFirstCard(
      card({ route: route({ sendFirst: true, alternatives: [] }) }),
      deps
    )
    const back = (await followNotMine(new Map([['k', first]]), deps)).get('k')
    expect(sent).toHaveLength(1)
    expect(back?.sent).toBeUndefined()
    expect(row(c, KEY)).toMatchObject({ outcome: null, reason: 'not-mine-no-next' })
  })

  it('«Wrong chat»: the owner’s chat gets it, the chat that had it is told to ignore it, the outcome is his chat', async () => {
    const c = core()
    logged(c, route())
    const { deps } = wired(c)
    const sentCard = await sendFirstCard(card(), deps)
    const told: { chat: string; prompt: string }[] = []
    const wrong = await hqIntakeWrongChat(sentCard, 'c', {
      deliver: async (chat, prompt) => (told.push({ chat, prompt }), true),
      rewriteOutcome: (key, input) => rewriteAutoOutcome(c, key, input),
      now: NOW + 5_000
    })
    expect(wrong).toBe(true)
    expect(told).toHaveLength(1)
    expect(told[0].chat).toBe('a')
    expect(told[0].prompt).toContain('ignore the message')
    expect(row(c, KEY)).toMatchObject({ outcome: 'other', chosen: 'c', reason: 'wrong-chat' })
    // «OK» (the same chat) and a card the router never sent change nothing.
    const none: string[] = []
    const deliver = async (chat: string) => (none.push(chat), true)
    const rewrite = () => none.push('rewrite')
    expect(
      await hqIntakeWrongChat(sentCard, 'a', { deliver, rewriteOutcome: rewrite, now: NOW })
    ).toBe(false)
    expect(
      await hqIntakeWrongChat(card(), 'c', { deliver, rewriteOutcome: rewrite, now: NOW })
    ).toBe(false)
    expect(none).toEqual([])
  })

  it('poll: a 👾 in the middle zone goes to №1 and its card stays up; «не моё» moves it in place; nothing goes to Slack', async () => {
    const c = core()
    const turns: HqRouterFinishedTurn[] = []
    const { deps: sendFirst, sent, tick } = wired(c, turns)
    const marked = draft('1795000000.000100')
    const synced: PulseBellInput[][] = []
    const settled: string[] = []
    const autoSent: string[] = []
    const poll = (raised: Map<string, string | null>): HqSlackIntakeDeps => ({
      read: async (run) =>
        run({
          marked: async () => ({ drafts: [marked], complete: true }),
          mentioned: async () => []
        }),
      raised: () => raised,
      guess: async () => ({ repoId: null, project: null, summary: 'Fix the export' }),
      sync: (_kind, items) => void synced.push([...items]),
      now: () => NOW,
      routerPreTrial: () => new Set(),
      route: async () => logged(c, route()),
      autoSend: async (intake) => (autoSent.push(intake.ts), true),
      settle: (key) => void settled.push(key),
      sendFirst
    })
    await pollHqSlackIntake(poll(new Map()))
    expect(sent.map((s) => s.chat)).toEqual(['a'])
    expect(autoSent).toEqual([])
    expect(settled).toEqual([])
    const [item] = synced[0]
    expect(item.body).toContain('→ sent to «A» · Wrong chat?')
    expect(JSON.parse(item.refId ?? '{}').sent).toMatchObject({ chat: 'a' })

    // Next poll: the card is up; chat A answered «не моё» — B gets it, the card rewrites itself.
    tick(60_000)
    turns.push({ chat: 'a', at: NOW + 10_000, text: 'не моё: не мой проект' })
    await pollHqSlackIntake(poll(new Map([[item.dedupeKey, item.refId ?? null]])))
    expect(sent.map((s) => s.chat)).toEqual(['a', 'b'])
    const moved = synced[1][0]
    expect(moved.replaces).toBe(item.dedupeKey)
    expect(JSON.parse(moved.refId ?? '{}').sent).toMatchObject({ chat: 'b' })
    expect(hqIntakeBellItem(JSON.parse(moved.refId ?? '{}')).body).toContain('sent to «B»')
    // Only agent chats were written to; the card never closed by itself.
    expect(settled).toEqual([])
  })
})
