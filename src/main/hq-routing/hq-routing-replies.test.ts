import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HQ_ROUTING_KIND, HQ_ROUTING_SOURCE } from '../../shared/hq-routing'
import type { HqReplyRule } from '../../shared/hq-reply-routing'
import type { PulseWaiting } from '../../shared/pulse-types'
import { PulseDb } from '../orca-plus/pulse/pulse-db'
import { passHqWaitingReply } from '../hq-today/hq-waiting-reply-pass'
import { createHqReplyRouting, HQ_REPLY_HOLD_MS } from './hq-routing-replies'

const DM = 'slack:D0AAAAAAAAA:1792184200.000100'
const LINK = 'https://acme.slack.com/archives/D0AAAAAAAAA/p1792184300000100'
const RULE: HqReplyRule = { do: 'send_to_asking_session', since: null }
const VERDICT = (change: Record<string, unknown> = {}) =>
  JSON.stringify({
    answers: true,
    complete: true,
    asked: 1,
    answered: 1,
    money: false,
    prod: false,
    deadline: false,
    new_request: false,
    question: false,
    ...change
  })

let db: PulseDb
let clock: number
let verdict: string | null
let chatOpen: boolean
let delivered: { sessionId: string | null; prompt: string }[]
let judge: ReturnType<typeof vi.fn<(prompt: string) => Promise<string | null>>>

function routing() {
  return createHqReplyRouting({
    listWaitings: () => db.listWaitings({ direction: 'on-them' }),
    judge,
    pass: (waitingId, replyTs, prompt) =>
      passHqWaitingReply(
        {
          listOpen: () => db.listWaitings({ status: 'open' }),
          deliver: async (waiting: PulseWaiting, text: string) => {
            if (chatOpen) {
              delivered.push({ sessionId: waiting.agentSessionId, prompt: text })
            }
            return chatOpen
          },
          markDelivered: (id, ts) => void db.markWaitingReplyDelivered(id, ts)
        },
        waitingId,
        replyTs,
        prompt
      ),
    settle: (id, ts) => void db.markWaitingReplyDelivered(id, ts),
    address: (sessionId) => (sessionId === 'chat-1' ? 'acme-api/orders' : null),
    asked: (personId) => {
      const person = db.listPeople().find((entry) => entry.id === personId)
      return person
        ? { slackUserId: person.slackUserId, clickupUserId: person.clickupUserId }
        : null
    },
    roomOf: async () => 'acme',
    personName: () => 'Ann',
    pulse: { list: (query) => db.listJournal(query), record: (inputs) => db.recordJournal(inputs) },
    now: () => clock,
    log: () => undefined
  })
}

let asked = 0

function answered(
  reply: string,
  change: { agentSessionId?: string | null } = {},
  authorId = 'U0ANN'
): PulseWaiting {
  asked += 1
  const ann = db.upsertPerson({ name: 'Ann', slackUserId: 'U0ANN' })
  const waiting = db.addWaiting({
    direction: 'on-them',
    // Why: an open waiting with the same title is the same waiting.
    title: `Which database holds the orders? (${asked})`,
    detail: 'Which database holds the orders, and is it the replica?',
    project: 'acme-api',
    source: 'slack',
    sourceRef: DM,
    agentSessionId: 'chat-1',
    personId: ann.id,
    ...change
  })
  db.recordWaitingReply(waiting.id, {
    text: reply,
    author: 'Ann',
    ts: '1792184300.000100',
    link: LINK,
    authorId
  })
  const recorded = db.getWaiting(waiting.id)
  if (!recorded) {
    throw new Error('the waiting was not recorded')
  }
  return recorded
}

function decisions() {
  return db
    .listJournal({ kind: HQ_ROUTING_KIND.action, source: HQ_ROUTING_SOURCE })
    .map((row) => ({ title: row.title, needs: row.needs, status: row.status }))
}

beforeEach(() => {
  clock = 1_792_184_400_000
  let id = 0
  db = new PulseDb(':memory:', { now: () => clock, newId: () => `w${++id}` })
  verdict = VERDICT()
  chatOpen = true
  delivered = []
  judge = vi.fn(async (_prompt: string) => verdict)
})

describe('person.reply routing', () => {
  it('hands a complete answer to the chat that asked, quoting the question, once', async () => {
    const replies = routing()
    const waiting = answered('The orders live in the reporting replica.')
    const [first] = await replies.route(RULE, { dryRun: false })
    expect(first?.kind).toBe('pass')
    expect(delivered).toHaveLength(1)
    expect(delivered[0]?.prompt).toContain('routing rule')
    expect(delivered[0]?.prompt).toContain('untrusted data')
    expect(delivered[0]?.prompt).toContain('is it the replica?')
    expect(delivered[0]?.prompt).toContain('The orders live in the reporting replica.')
    expect(db.getWaiting(waiting.id)?.replyDeliveredAt).toEqual(expect.any(Number))
    expect(decisions()).toEqual([
      { title: "Ann's answer passed to acme-api/orders by rule", needs: 'nobody', status: 'done' }
    ])
    expect(await replies.route(RULE, { dryRun: false })).toEqual([])
    expect(judge).toHaveBeenCalledTimes(1)
  })

  it('leaves money, a partial answer or a model in doubt to the owner, with the reason on the card', async () => {
    const replies = routing()
    const money = answered('Refund is 40 USD')
    verdict = VERDICT({ complete: false, asked: 3, answered: 1 })
    const partial = answered('The orders are in the replica; the rest later.')
    const actions = await replies.route(RULE, { dryRun: false })
    expect(actions.map((action) => [action.kind, action.reasons])).toEqual([
      ['card', ['money']],
      ['card', ['partial']]
    ])
    // Why: money was certain from the text alone; no model was asked about it.
    expect(judge).toHaveBeenCalledTimes(1)
    expect(delivered).toEqual([])
    expect(replies.note(money).why).toBe('Not passed by itself: money.')
    expect(replies.note(partial).why).toBe('Not passed by itself: partial answer (1 of 3).')
    expect(decisions().every((row) => row.needs === 'owner:decide' && row.status === 'open')).toBe(
      true
    )
    // The owner passes it by hand: the card row is nobody's move any more.
    db.markWaitingReplyDelivered(money.id, '1792184300.000100')
    await replies.route(RULE, { dryRun: false })
    expect(decisions().filter((row) => row.status === 'open')).toHaveLength(1)
  })

  it('asks a silent model again a few minutes later, and makes a card after three misses', async () => {
    const replies = routing()
    verdict = 'sorry'
    const waiting = answered('The orders live in the reporting replica.')
    // Why: a fresh answer is held from the start, until it is judged.
    expect(replies.note(waiting).hold).toBe(true)
    expect((await replies.route(RULE, { dryRun: false }))[0]?.kind).toBe('wait')
    expect(replies.note(waiting).hold).toBe(true)
    await replies.route(RULE, { dryRun: false })
    expect(judge).toHaveBeenCalledTimes(1)
    clock += 5 * 60_000
    await replies.route(RULE, { dryRun: false })
    clock += 5 * 60_000
    const [last] = await replies.route(RULE, { dryRun: false })
    expect(judge).toHaveBeenCalledTimes(3)
    expect(last?.reasons).toEqual(['unread'])
    clock += HQ_REPLY_HOLD_MS
    expect(replies.note(waiting)).toEqual({
      hold: false,
      why: 'Not passed by itself: could not be read.'
    })
  })

  it('never lets an unreviewed answer open a chat: a closed asking chat means a card', async () => {
    const replies = routing()
    chatOpen = false
    const waiting = answered('The orders live in the reporting replica.')
    expect((await replies.route(RULE, { dryRun: false }))[0]?.reasons).toEqual(['chat-closed'])
    expect(delivered).toEqual([])
    expect(db.getWaiting(waiting.id)?.replyDeliveredAt).toBeNull()
  })

  it('leaves an answer someone else wrote to the owner, before any model reads it', async () => {
    const replies = routing()
    answered('The orders live in the reporting replica.', {}, 'U0BOB')
    expect((await replies.route(RULE, { dryRun: false }))[0]?.reasons).toEqual(['other-author'])
    expect(judge).not.toHaveBeenCalled()
  })

  it('without the rule only sorts out the owner\'s own talk; a dry run looks back over handled ones', async () => {
    const replies = routing()
    const waiting = answered('The orders live in the reporting replica.')
    judge.mockResolvedValueOnce('CHAT')
    expect(await replies.route(null, { dryRun: false })).toEqual([])
    await replies.route(null, { dryRun: false })
    expect(judge).toHaveBeenCalledTimes(1)
    db.markWaitingReplyDelivered(waiting.id, '1792184300.000100')
    const looked = await replies.route(null, { dryRun: true, since: 0 })
    expect(looked.map((action) => action.kind)).toEqual(['pass'])
    expect(delivered).toEqual([])
    expect(decisions()).toEqual([])
  })
})

// 28.10: with the rule off every answer was a card, even talk the owner answers himself in Slack.
describe('with the rule off', () => {
  it("settles the owner's own talk without a card and keeps the chat's answer for the card", async () => {
    const service = routing()
    const talk = answered('License goes through Priority support now, it depends on them')
    judge.mockResolvedValueOnce('OWNER')
    expect(service.note(talk)).toEqual({ hold: true, why: null })
    await service.route(null, { dryRun: false })
    expect(db.getWaiting(talk.id)?.replyDeliveredAt).not.toBeNull()
    expect(decisions()).toEqual([
      expect.objectContaining({ needs: 'nobody', status: 'done' })
    ])
    const fact = answered('Postgres, the replica is read-only')
    judge.mockResolvedValueOnce('CHAT')
    await service.route(null, { dryRun: false })
    expect(db.getWaiting(fact.id)?.replyDeliveredAt).toBeNull()
    expect(service.note(fact)).toEqual({ hold: false, why: null })
    expect(delivered).toEqual([])
  })
})
