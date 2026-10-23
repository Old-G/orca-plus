import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HQ_ROUTING_KIND, HQ_ROUTING_SOURCE } from '../../shared/hq-routing'
import type { HqReplyRule } from '../../shared/hq-reply-routing'
import type { PulseWaiting } from '../../shared/pulse-types'
import { PulseDb } from '../orca-plus/pulse/pulse-db'
import { passHqWaitingReply } from '../hq-today/hq-waiting-reply-pass'
import { createHqReplyRouting, HQ_REPLY_HOLD_MS, type HqReplyDispatch } from './hq-routing-replies'

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
let dispatched: HqReplyDispatch | null
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
    markDelivered: (id, ts) => void db.markWaitingReplyDelivered(id, ts),
    address: (sessionId) => (sessionId === 'chat-1' ? 'acme-api/orders' : null),
    dispatch: async (_address, prompt) => {
      delivered.push({ sessionId: 'dispatcher', prompt })
      return dispatched
    },
    roomOf: async () => 'acme',
    personName: () => 'Ann',
    pulse: { list: (query) => db.listJournal(query), record: (inputs) => db.recordJournal(inputs) },
    now: () => clock,
    log: () => undefined
  })
}

let asked = 0

function answered(reply: string, change: { agentSessionId?: string | null } = {}): PulseWaiting {
  asked += 1
  const waiting = db.addWaiting({
    direction: 'on-them',
    // Why: an open waiting with the same title is the same waiting.
    title: `Which database holds the orders? (${asked})`,
    detail: 'Which database holds the orders, and is it the replica?',
    project: 'acme-api',
    source: 'slack',
    sourceRef: DM,
    agentSessionId: 'chat-1',
    ...change
  })
  db.recordWaitingReply(waiting.id, {
    text: reply,
    author: 'Ann',
    ts: '1792184300.000100',
    link: LINK
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
  dispatched = null
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
    expect(replies.note(waiting).hold).toBe(false)
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

  it("gives a closed chat's thread to the dispatcher, else leaves a card", async () => {
    const replies = routing()
    chatOpen = false
    dispatched = { acted: true, how: 'new', note: null }
    const first = answered('The orders live in the reporting replica.')
    expect((await replies.route(RULE, { dryRun: false }))[0]).toMatchObject({
      kind: 'dispatch',
      address: 'acme-api/orders'
    })
    expect(db.getWaiting(first.id)?.replyDeliveredAt).toEqual(expect.any(Number))
    dispatched = { acted: false, how: 'new', note: 'Report mode: nothing done.' }
    answered('The orders live in the reporting replica, yes.')
    expect((await replies.route(RULE, { dryRun: false }))[0]?.reasons).toEqual(['chat-closed'])
  })

  it('does nothing and asks no model without the rule; a dry run looks back over handled ones', async () => {
    const replies = routing()
    const waiting = answered('The orders live in the reporting replica.')
    expect(await replies.route(null, { dryRun: false })).toEqual([])
    expect(judge).not.toHaveBeenCalled()
    db.markWaitingReplyDelivered(waiting.id, '1792184300.000100')
    const looked = await replies.route(null, { dryRun: true, since: 0 })
    expect(looked.map((action) => action.kind)).toEqual(['pass'])
    expect(delivered).toEqual([])
    expect(decisions()).toEqual([])
  })
})
