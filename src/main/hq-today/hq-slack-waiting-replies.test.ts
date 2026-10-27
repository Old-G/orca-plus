import { describe, expect, it, vi } from 'vitest'
import { PulseDb } from '../orca-plus/pulse/pulse-db'
import { SlackApiError } from '../slack/slack-request'
import {
  parseHqReplyPick,
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
    userName: vi.fn(async (user: string) => `slack-${user}`),
    permalink: vi.fn(async (channel: string, ts: string) => `https://s.example/${channel}/${ts}`)
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

  it('hears a reply in a DM thread the owner started before recording the question', async () => {
    const { db, anna, dm, thread, deps, at } = setup()
    const byHand = db.addWaiting({
      direction: 'on-them',
      title: 'Shipping facts',
      personId: anna.id,
      source: 'manual',
      agentSessionId: 'chat-1'
    })
    const parentAt = ASKED_AT - 15 * 60_000
    const parentTs = (parentAt / 1000).toFixed(6)
    const replyTs = ((ASKED_AT + 60_000) / 1000).toFixed(6)
    dm.push(msg(parentAt, OWNER, '6 questions', { threadTs: parentTs, latestReply: replyTs }))
    thread.push(msg(parentAt, OWNER, '6 questions', { threadTs: parentTs }))
    thread.push(msg(ASKED_AT - 60_000, ANNA, 'said before the question', { threadTs: parentTs }))
    thread.push(msg(ASKED_AT + 60_000, ANNA, '1. table attached', { threadTs: parentTs }))
    at(ASKED_AT + 5 * 60_000)
    expect(await pollHqSlackWaitingReplies(deps)).toBe(1)
    expect(db.getWaiting(byHand.id)).toMatchObject({
      reply: 'Анна Ли: 1. table attached',
      replyLink: `https://s.example/DANNA01/${replyTs}`
    })
  })

  it('still hears the DM when the question’s thread cannot be read', async () => {
    const { db, anna, dm, api, deps, at } = setup()
    const asked = db.addWaiting({
      direction: 'on-them',
      title: 'Phone hours',
      personId: anna.id,
      source: 'slack',
      sourceRef: 'slack:DANNA01:1792184199.000100',
      agentSessionId: 'chat-1'
    })
    vi.mocked(api.replies).mockRejectedValue(new Error('channel_not_found'))
    dm.push(msg(ASKED_AT + 60_000, ANNA, 'Sun–Thu'))
    at(ASKED_AT + 5 * 60_000)
    expect(await pollHqSlackWaitingReplies(deps)).toBe(1)
    expect(db.getWaiting(asked.id)?.reply).toBe('Анна Ли: Sun–Thu')
  })

  it('takes the thread reply but not a newer DM about another topic', async () => {
    const { db, anna, dm, thread, deps, at } = setup()
    const asked = db.addWaiting({
      direction: 'on-them',
      title: 'Phone hours',
      personId: anna.id,
      source: 'slack',
      sourceRef: 'slack:DANNA01:1792184199.000100',
      agentSessionId: 'chat-1'
    })
    thread.push(msg(ASKED_AT + 60_000, ANNA, 'Sun–Thu', { threadTs: '1792184199.000100' }))
    dm.push(msg(ASKED_AT + 90_000, ANNA, 'other topic: lunch?'))
    at(ASKED_AT + 5 * 60_000)
    expect(await pollHqSlackWaitingReplies(deps)).toBe(1)
    expect(db.getWaiting(asked.id)?.reply).toBe('Анна Ли: Sun–Thu')
  })

  it('lets a revoked token or a missing scope reach the reader status', async () => {
    const { db, anna, api, deps, at } = setup()
    db.addWaiting({
      direction: 'on-them',
      title: 'Phone hours',
      personId: anna.id,
      source: 'manual',
      agentSessionId: 'chat-1'
    })
    vi.mocked(api.history).mockRejectedValue(new SlackApiError('missing_scope', 'missing_scope'))
    at(ASKED_AT + 5 * 60_000)
    await expect(pollHqSlackWaitingReplies(deps)).rejects.toThrow('missing_scope')
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
  it('gives a channel-thread reply to one of the questions asked in that thread, not to each', async () => {
    const { db, thread, deps, at } = setup()
    const parent = '1792184199.000100'
    const ask = (title: string) =>
      db.addWaiting({
        direction: 'on-them',
        title,
        source: 'slack',
        sourceRef: `slack:C0AAAAAAAAA:${parent}`
      })
    const merge = ask('Merge hub !296')
    const move = ask('Repeat the move after the collision')
    const pick = vi.fn(async (questions: readonly string[]) =>
      questions.findIndex((question) => question.includes('Merge'))
    )
    deps.pickAnswer = pick
    thread.push(msg(ASKED_AT + 50_000, 'UCAROL', '@owner merged', { threadTs: parent }))
    at(ASKED_AT + 5 * 60_000)
    expect(await pollHqSlackWaitingReplies(deps)).toBe(1)
    expect(pick).toHaveBeenCalledTimes(1)
    expect(db.getWaiting(merge.id)?.reply).toContain('merged')
    expect(db.getWaiting(move.id)?.reply ?? null).toBeNull()
    // Why: the next poll does not offer the same reply to the other question again.
    expect(await pollHqSlackWaitingReplies(deps)).toBe(0)
  })

  it('gives one DM message to one of the questions asked in separate DM threads, also after a restart', async () => {
    const { db, anna, dm, deps, at } = setup()
    const ask = (title: string, threadTs: string) =>
      db.addWaiting({
        direction: 'on-them',
        title,
        personId: anna.id,
        source: 'slack',
        sourceRef: `slack:DANNA01:${threadTs}`
      })
    at(ASKED_AT - 3_000)
    const connector = ask('Did the hub connector connect', '1792184100.000100')
    at(ASKED_AT - 2_000)
    const cases = ask('Confirm the 18 eval cases', '1792184150.000100')
    at(ASKED_AT - 1_000)
    const amount = ask('Which amount to charge on a card update', '1792184199.000100')
    const pick = vi.fn(async (questions: readonly string[]) => questions.length - 1)
    deps.pickAnswer = pick
    dm.push(msg(ASKED_AT + 60_000, ANNA, 'Привет'))
    dm.push(msg(ASKED_AT + 70_000, ANNA, 'Да'))
    at(ASKED_AT + 160_000)
    expect(await pollHqSlackWaitingReplies(deps)).toBe(1)
    expect(db.getWaiting(amount.id)?.reply).toContain('Да')
    expect(db.getWaiting(connector.id)?.reply ?? null).toBeNull()
    expect(db.getWaiting(cases.id)?.reply ?? null).toBeNull()
    // Why a fresh map: a restart forgets what this pass handed out; the owner keeps the message.
    expect(await pollHqSlackWaitingReplies(deps, new Map())).toBe(0)
    expect(pick).toHaveBeenCalledTimes(1)
  })

  it('does not hand a message a question took to another one after the first is closed', async () => {
    const { db, anna, dm, deps, at } = setup()
    const ask = (title: string) =>
      db.addWaiting({ direction: 'on-them', title, personId: anna.id, source: 'manual' })
    at(ASKED_AT - 2_000)
    const review = ask('Approve hub MR !316')
    at(ASKED_AT - 1_000)
    const connector = ask('Did the hub connector connect')
    deps.pickAnswer = vi.fn(async (questions: readonly string[]) =>
      questions.findIndex((question) => question.includes('!316'))
    )
    deps.listTaken = () => db.listWaitings({}).filter((waiting) => waiting.status !== 'open')
    dm.push(msg(ASKED_AT + 60_000, ANNA, 'Looked at !316, all fine, approving'))
    at(ASKED_AT + 160_000)
    await pollHqSlackWaitingReplies(deps)
    expect(db.getWaiting(review.id)?.reply).toContain('!316')
    db.closeWaiting(review.id, 'resolved')
    at(ASKED_AT + 60 * 60_000)
    // Why a fresh map: an hour later, or after a restart, nothing of this pass is remembered.
    expect(await pollHqSlackWaitingReplies(deps, new Map())).toBe(0)
    expect(db.getWaiting(connector.id)?.reply ?? null).toBeNull()
  })

  it('gives a DM burst to the one open question it answers, not to every question in that DM', async () => {
    const { db, anna, dm, deps, at } = setup()
    const ask = (title: string) =>
      db.addWaiting({
        direction: 'on-them',
        title,
        personId: anna.id,
        source: 'slack',
        sourceRef: 'slack:DANNA01:1792184199.000100'
      })
    const cases = ask('Confirm the 18 eval cases')
    const refund = ask('Which amount to charge on a card update')
    const connector = ask('Did the hub connector connect')
    const pick = vi.fn(async (questions: readonly string[]) =>
      questions.findIndex((question) => question.includes('connector'))
    )
    deps.pickAnswer = pick
    dm.push(msg(ASKED_AT + 60_000, ANNA, 'Hi'))
    dm.push(msg(ASKED_AT + 70_000, ANNA, 'the connector works too'))
    at(ASKED_AT + 160_000)
    expect(await pollHqSlackWaitingReplies(deps)).toBe(1)
    expect(pick).toHaveBeenCalledTimes(1)
    expect(db.getWaiting(connector.id)?.reply).toContain('the connector works too')
    expect(db.getWaiting(cases.id)?.reply ?? null).toBeNull()
    expect(db.getWaiting(refund.id)?.reply ?? null).toBeNull()
  })

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

describe('parseHqReplyPick', () => {
  it('reads a question number in range, and none for anything else', () => {
    expect(parseHqReplyPick('{"answers": 2}', 3)).toBe(1)
    expect(parseHqReplyPick('{"answers": null}', 3)).toBeNull()
    expect(parseHqReplyPick('{"answers": 4}', 3)).toBeNull()
    expect(parseHqReplyPick('no idea', 3)).toBeNull()
  })
})
