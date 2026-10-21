import { describe, expect, it, vi } from 'vitest'
import { PulseDb } from '../orca-plus/pulse/pulse-db'
import {
  parseHqReplyRelevance,
  plainSlackText,
  pollHqSlackWaitingReplies,
  type HqSlackWaitingDeps,
  type SlackReadApi,
  type SlackReadMessage
} from './hq-slack-waiting-replies'

const OWNER = 'UOWNER'
const ANNA = 'UANNA'
const ASKED_AT = 1_792_184_200_000
const DAY = 24 * 60 * 60_000

function msg(ts: number, user: string, text: string, extra: Partial<SlackReadMessage> = {}) {
  return { ts: (ts / 1000).toFixed(6), user, text, threadTs: null, bot: false, ...extra }
}

function setup() {
  let now = ASKED_AT
  let id = 0
  const db = new PulseDb(':memory:', { now: () => now, newId: () => `w${++id}` })
  const anna = db.upsertPerson({ name: 'Анна Ли', slackUserId: ANNA })
  const dm: SlackReadMessage[] = []
  const thread: SlackReadMessage[] = []
  const api: SlackReadApi = {
    owner: OWNER,
    history: vi.fn(async (_channel: string, oldest: string) =>
      dm.filter((m) => Number(m.ts) > Number(oldest))
    ),
    replies: vi.fn(async (_channel: string, _threadTs: string, oldest: string) =>
      thread.filter((m) => Number(m.ts) > Number(oldest))
    ),
    dmChannel: vi.fn(async (user: string) => (user === ANNA ? 'DANNA01' : null)),
    userName: vi.fn(async (user: string) => `slack-${user}`)
  }
  let connected = true
  const deps: HqSlackWaitingDeps = {
    listOpen: () => db.listWaitings({ status: 'open' }),
    personSlackId: (personId) => db.getPerson(personId)?.slackUserId ?? null,
    knownName: (user) => (user === ANNA ? 'Анна Ли' : null),
    read: async (run) => (connected ? run(api) : null),
    recordReply: (waitingId, reply) => db.recordWaitingReply(waitingId, reply),
    isAnswer: async (_question, said) => !said.includes('other topic'),
    now: () => now
  }
  return {
    db,
    anna,
    dm,
    thread,
    api,
    deps,
    at: (ms: number) => {
      now = ms
    },
    disconnect: () => {
      connected = false
    }
  }
}

describe('pollHqSlackWaitingReplies', () => {
  it('hears a plain DM answer to a question asked in the DM, once the person pauses', async () => {
    const { db, anna, dm, deps, at } = setup()
    const asked = db.addWaiting({
      direction: 'on-them',
      title: 'Phone hours',
      personId: anna.id,
      source: 'slack',
      sourceRef: 'slack:DANNA01:1792184199.000100',
      agentSessionId: 'chat-1'
    })
    dm.push(msg(ASKED_AT - 60_000, ANNA, 'said before the question'))
    dm.push(msg(ASKED_AT + 60_000, ANNA, 'Sun–Thu'))
    dm.push(msg(ASKED_AT + 90_000, ANNA, '9–18 local time'))
    dm.push(msg(ASKED_AT + 95_000, OWNER, 'thanks'))
    at(ASKED_AT + 120_000)
    expect(await pollHqSlackWaitingReplies(deps)).toBe(0)
    at(ASKED_AT + 160_000)
    expect(await pollHqSlackWaitingReplies(deps)).toBe(1)
    expect(db.getWaiting(asked.id)).toMatchObject({
      reply: 'Анна Ли: Sun–Thu\nАнна Ли: 9–18 local time',
      replyAuthor: 'Анна Ли',
      replyDeliveredAt: null
    })
    expect(await pollHqSlackWaitingReplies(deps)).toBe(0)
  })

  it('hears the DM for a question recorded with no place, but not for one asked on a task', async () => {
    const { db, anna, dm, deps, at } = setup()
    const byHand = db.addWaiting({
      direction: 'on-them',
      title: 'Phone hours',
      personId: anna.id,
      source: 'manual',
      agentSessionId: 'chat-1'
    })
    const onTask = db.addWaiting({
      direction: 'on-them',
      title: 'Routing review',
      personId: anna.id,
      source: 'clickup',
      sourceRef: 'clickup:DEV-1:123',
      agentSessionId: 'chat-2'
    })
    dm.push(msg(ASKED_AT + 60_000, ANNA, 'Sun–Thu'))
    at(ASKED_AT + 5 * 60_000)
    await pollHqSlackWaitingReplies(deps)
    expect(db.getWaiting(byHand.id)?.reply).toBe('Анна Ли: Sun–Thu')
    expect(db.getWaiting(onTask.id)?.reply).toBeNull()
  })

  it('takes thread replies from anyone but the owner and bots, never the question itself', async () => {
    const { db, thread, deps, at } = setup()
    const asked = db.addWaiting({
      direction: 'on-them',
      title: 'Search keys',
      source: 'slack',
      sourceRef: 'slack:C0AAAAAAAAA:1792184199.000100'
    })
    const parent = '1792184199.000100'
    thread.push(msg(ASKED_AT + 1_000, 'UCAROL', 'question echo', { ts: parent }))
    thread.push(msg(ASKED_AT + 30_000, OWNER, 'ping', { threadTs: parent }))
    thread.push(msg(ASKED_AT + 40_000, 'UBOT', 'beep', { threadTs: parent, bot: true }))
    thread.push(msg(ASKED_AT + 50_000, 'UCAROL', 'JSON is fine', { threadTs: parent }))
    at(ASKED_AT + 5 * 60_000)
    await pollHqSlackWaitingReplies(deps)
    expect(db.getWaiting(asked.id)).toMatchObject({
      reply: 'slack-UCAROL: JSON is fine',
      replyAuthor: 'slack-UCAROL'
    })
  })

  it('offers only what came after an answer already handled', async () => {
    const { db, anna, dm, deps, at } = setup()
    const asked = db.addWaiting({
      direction: 'on-them',
      title: 'Phone hours',
      personId: anna.id,
      source: 'manual',
      agentSessionId: 'chat-1'
    })
    dm.push(msg(ASKED_AT + 60_000, ANNA, 'Привет'))
    at(ASKED_AT + 5 * 60_000)
    const handled = new Map<string, string>()
    await pollHqSlackWaitingReplies(deps, handled)
    db.markWaitingReplyDelivered(asked.id)
    dm.push(msg(ASKED_AT + 6 * 60_000, ANNA, 'Sun–Thu 9–18'))
    at(ASKED_AT + 10 * 60_000)
    await pollHqSlackWaitingReplies(deps, handled)
    expect(db.getWaiting(asked.id)).toMatchObject({
      reply: 'Анна Ли: Sun–Thu 9–18',
      replyDeliveredAt: null
    })
  })

  it('leaves a week-old question out of the DM watch', async () => {
    const { db, anna, dm, deps, at, api } = setup()
    db.addWaiting({ direction: 'on-them', title: 'Old', personId: anna.id, source: 'manual' })
    dm.push(msg(ASKED_AT + 8 * DAY, ANNA, 'something new'))
    at(ASKED_AT + 8 * DAY + 5 * 60_000)
    expect(await pollHqSlackWaitingReplies(deps)).toBe(0)
    expect(api.history).not.toHaveBeenCalled()
  })

  it('does nothing without the owner’s Slack token', async () => {
    const { db, anna, deps, disconnect, api } = setup()
    db.addWaiting({
      direction: 'on-them',
      title: 'Phone hours',
      personId: anna.id,
      source: 'manual'
    })
    disconnect()
    expect(await pollHqSlackWaitingReplies(deps)).toBe(0)
    expect(api.dmChannel).not.toHaveBeenCalled()
  })
})

describe('pollHqSlackWaitingReplies relevance', () => {
  it('leaves a DM about another topic off the question, and does not ask about it again', async () => {
    const { db, anna, dm, deps, at } = setup()
    const asked = db.addWaiting({
      direction: 'on-them',
      title: 'Phone hours',
      personId: anna.id,
      source: 'manual',
      agentSessionId: 'chat-1'
    })
    dm.push(msg(ASKED_AT + 60_000, ANNA, 'other topic: the signature'))
    at(ASKED_AT + 5 * 60_000)
    const handled = new Map<string, string>()
    await pollHqSlackWaitingReplies(deps, handled)
    expect(db.getWaiting(asked.id)?.reply).toBeNull()
    dm.push(msg(ASKED_AT + 6 * 60_000, ANNA, 'Sun–Thu 9–18'))
    at(ASKED_AT + 10 * 60_000)
    await pollHqSlackWaitingReplies(deps, handled)
    expect(db.getWaiting(asked.id)?.reply).toBe('Анна Ли: Sun–Thu 9–18')
  })
})

describe('plainSlackText', () => {
  it('turns Slack link markup into readable text', () => {
    expect(plainSlackText('see <https://x.dev/a|the doc> &amp; <https://x.dev/b>')).toBe(
      'see the doc (https://x.dev/a) & https://x.dev/b'
    )
  })
})

describe('parseHqReplyRelevance', () => {
  it('reads the model’s verdict and counts a garbled one as an answer', () => {
    expect(parseHqReplyRelevance('{"answer": false}')).toBe(false)
    expect(parseHqReplyRelevance('Sure: {"answer": true}')).toBe(true)
    expect(parseHqReplyRelevance('no idea')).toBe(true)
  })
})
