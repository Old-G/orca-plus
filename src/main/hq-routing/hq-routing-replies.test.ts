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
/** What the model says on who acts on an answer (CHAT, OWNER or NOISE). */
let talk: string | null

const TALK_PROMPT = 'CHAT, OWNER or NOISE'
/** The model's calls of one kind: who acts on an answer, or the verdict on passing it. */
function asks(kind: 'talk' | 'verdict'): number {
  return judge.mock.calls.filter(([prompt]) => prompt.includes(TALK_PROMPT) === (kind === 'talk'))
    .length
}

function routing() {
  return createHqReplyRouting(routingDeps())
}

function routingDeps(): Parameters<typeof createHqReplyRouting>[0] {
  return {
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
    skip: (waitingId, replyTs) => void db.markWaitingReplyDelivered(waitingId, replyTs),
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
  }
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
  talk = 'CHAT'
  judge = vi.fn(async (prompt: string) => (prompt.includes(TALK_PROMPT) ? talk : verdict))
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
    expect([asks('talk'), asks('verdict')]).toEqual([1, 1])
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
    expect(asks('verdict')).toBe(1)
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
    expect(asks('verdict')).toBe(1)
    clock += 5 * 60_000
    await replies.route(RULE, { dryRun: false })
    clock += 5 * 60_000
    const [last] = await replies.route(RULE, { dryRun: false })
    expect([asks('talk'), asks('verdict')]).toEqual([1, 3])
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

  it('leaves an answer someone else wrote to the owner, before the verdict model reads it', async () => {
    const replies = routing()
    answered('The orders live in the reporting replica.', {}, 'U0BOB')
    expect((await replies.route(RULE, { dryRun: false }))[0]?.reasons).toEqual(['other-author'])
    expect(asks('verdict')).toBe(0)
  })

  // 25.11 (итоги дня №2): with the rule on, a thanks and the owner's own talk still make no pass and no card.
  it('with the rule on still handles a thanks with no card and leaves the owner his own talk', async () => {
    const replies = routing()
    talk = 'NOISE'
    const thanks = answered('Thank you so much, it all adds up!')
    const [first] = await replies.route(RULE, { dryRun: false })
    expect(first).toEqual(
      expect.objectContaining({ kind: 'wait', note: 'thanks or small talk, no card' })
    )
    expect(db.getWaiting(thanks.id)?.replyDeliveredAt).toEqual(expect.any(Number))
    expect(db.getWaiting(thanks.id)?.status).toBe('open')
    talk = 'OWNER'
    const news = answered('License goes through Priority support now, it depends on them')
    await replies.route(RULE, { dryRun: false })
    expect(replies.note(news).why).toBe('Your move in Slack: this answers you, not the chat')
    expect(db.getWaiting(news.id)?.replyDeliveredAt).toBeNull()
    expect(delivered).toEqual([])
    expect(asks('verdict')).toBe(0)
    expect(decisions().every((row) => row.needs === 'nobody' && row.status === 'done')).toBe(true)
  })

  it('makes money or production a card by the text alone, before the thanks sort can settle it', async () => {
    const replies = routing()
    talk = 'NOISE'
    const money = answered('Thanks! It is $40 a month, as before')
    const [first] = await replies.route(RULE, { dryRun: false })
    expect(first?.kind).toBe('card')
    expect(first?.reasons).toContain('money')
    expect(asks('talk')).toBe(0)
    expect(db.getWaiting(money.id)?.replyDeliveredAt).toBeNull()
  })

  it("keeps the owner's own talk marked as his move in Slack after a restart", async () => {
    talk = 'OWNER'
    const news = answered('License goes through Priority support now, it depends on them')
    await routing().route(RULE, { dryRun: false })
    const restarted = routing()
    await restarted.route(RULE, { dryRun: false })
    expect(restarted.note(news).why).toBe('Your move in Slack: this answers you, not the chat')
  })

  describe("GitLab's word on the asked MR", () => {
    const MR = 'https://gitlab.com/acme/api/-/merge_requests/319'

    function gitlab(reply: string, link = MR, sourceRef = MR): PulseWaiting {
      const waiting = db.addWaiting({
        direction: 'on-them',
        title: `Merge !319 after the green pipeline? (${(asked += 1)})`,
        project: 'acme-api',
        source: 'gitlab',
        sourceRef,
        agentSessionId: 'chat-1'
      })
      db.recordWaitingReply(waiting.id, {
        text: reply,
        author: 'GitLab',
        ts: '1792184300.000200',
        link,
        authorId: 'gitlab'
      })
      return db.getWaiting(waiting.id) as PulseWaiting
    }

    it('passes «merged» on the very MR the chat asked about, the model reading only the fact', async () => {
      const replies = routing()
      // Why: the question is about merging, which the verdict model may flag as prod; only
      // completeness counts against GitLab's fact.
      verdict = VERDICT({ prod: true })
      gitlab('GitLab: MR !319 (acme/api) merged by Ann — orders: read the replica, deploy notes')
      const [first] = await replies.route(RULE, { dryRun: false })
      expect(first?.kind).toBe('pass')
      expect(delivered).toHaveLength(1)
      expect(asks('talk')).toBe(0)
      expect(asks('verdict')).toBe(1)
      expect(judge.mock.calls[0]?.[0]).not.toContain('deploy notes')
      // Why: the title and names are someone else's words; the chat gets only GitLab's fact.
      expect(delivered[0]?.prompt).toContain('GitLab: MR !319 (acme/api) merged')
      expect(delivered[0]?.prompt).not.toContain('deploy notes')
      expect(delivered[0]?.prompt).not.toContain('by Ann')
    })

    it('leaves the notice to the owner while another chat waits on the same MR', async () => {
      const replies = routing()
      db.addWaiting({
        direction: 'on-them',
        title: 'Deploy once !319 is merged',
        project: 'acme-api',
        source: 'gitlab',
        sourceRef: MR,
        agentSessionId: 'chat-2'
      })
      gitlab('GitLab: MR !319 (acme/api) merged by Ann')
      const actions = await replies.route(RULE, { dryRun: false })
      expect(actions.map((action) => [action.kind, action.reasons])).toEqual([
        ['card', ['shared-message']]
      ])
      expect(delivered).toEqual([])
    })

    it('passes the notice on a Slack waiting that links the MR; a bare «!319» stays a card', async () => {
      const replies = routing()
      const linked = db.addWaiting({
        direction: 'on-them',
        title: `Merge after the green pipeline (${(asked += 1)})`,
        detail: `Please merge ${MR}`,
        project: 'acme-api',
        source: 'slack',
        sourceRef: DM,
        agentSessionId: 'chat-1'
      })
      const bare = db.addWaiting({
        direction: 'on-them',
        title: `Merge !319 after the green pipeline (${(asked += 1)})`,
        project: 'acme-api',
        source: 'slack',
        sourceRef: DM,
        agentSessionId: 'chat-1'
      })
      // Why: two notices, not one message matched to two waitings (that is a card of its own).
      for (const [waiting, ts] of [
        [linked, '1792184300.000200'],
        [bare, '1792184300.000300']
      ] as const) {
        db.recordWaitingReply(waiting.id, {
          text: 'GitLab: MR !319 (acme/api) merged by Ann',
          author: 'GitLab',
          ts,
          link: MR,
          authorId: 'gitlab'
        })
      }
      const actions = await replies.route(RULE, { dryRun: false })
      expect(actions.map((action) => [action.waitingId, action.kind, action.reasons])).toEqual([
        [linked.id, 'pass', []],
        [bare.id, 'card', ['other-author', 'other-venue']]
      ])
    })

    it('leaves «merged» to the owner when the chat asked more than the merge', async () => {
      const replies = routing()
      verdict = VERDICT({ complete: false, asked: 3, answered: 1 })
      gitlab('GitLab: MR !319 (acme/api) merged by Ann')
      const [first] = await replies.route(RULE, { dryRun: false })
      expect(first?.kind).toBe('card')
      expect(first?.reasons).toEqual(['partial'])
      expect(delivered).toEqual([])
    })

    it.each([
      ['a bare «!319» in the same project', 'acme-api', 'Deploy once !319 is merged', null, true],
      ['its link in the detail', 'acme-web', 'Tell the docs chat', `Ping when ${MR} lands`, true],
      ['a bare «!319» in another project', 'acme-web', 'Deploy once !319 is merged', null, false]
    ])(
      'counts another chat that names the MR only in its words: %s',
      async (_case, project, title, detail, shared) => {
        const replies = routing()
        db.addWaiting({
          direction: 'on-them',
          title,
          detail,
          project,
          source: 'slack',
          sourceRef: DM,
          agentSessionId: 'chat-2'
        })
        gitlab('GitLab: MR !319 (acme/api) merged by Ann')
        const [first] = await replies.route(RULE, { dryRun: false })
        expect(first?.kind).toBe(shared ? 'card' : 'pass')
        expect(first?.reasons).toEqual(shared ? ['shared-message'] : [])
      }
    )

    it('leaves another MR, or one closed without merging, to the owner', async () => {
      const replies = routing()
      gitlab(
        'GitLab: MR !318 (acme/api) merged by Ann',
        'https://gitlab.com/acme/api/-/merge_requests/318'
      )
      gitlab('GitLab: MR !319 (acme/api) closed without merging')
      const actions = await replies.route(RULE, { dryRun: false })
      expect(actions.map((action) => action.kind)).toEqual(['card', 'card'])
      expect(actions[0]?.reasons).toContain('other-venue')
      expect(actions[1]?.reasons).toContain('other-author')
      expect(delivered).toEqual([])
    })
  })

  it("without the rule only sorts out the owner's own talk; a dry run looks back over handled ones", async () => {
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
  it("keeps the owner's own talk on its card as his move in Slack, and the chat's answer for the card", async () => {
    const service = routing()
    const talk = answered('License goes through Priority support now, it depends on them')
    judge.mockResolvedValueOnce('OWNER')
    expect(service.note(talk)).toEqual({ hold: true, why: null })
    await service.route(null, { dryRun: false })
    // 04.11: settled quietly, a colleague's «merged, testing now» reached nobody — the card stays.
    expect(db.getWaiting(talk.id)?.replyDeliveredAt).toBeNull()
    expect(service.note(talk)).toEqual({
      hold: false,
      why: 'Your move in Slack: this answers you, not the chat'
    })
    expect(decisions()).toEqual([expect.objectContaining({ needs: 'nobody', status: 'done' })])
    const fact = answered('Postgres, the replica is read-only')
    judge.mockResolvedValueOnce('CHAT')
    await service.route(null, { dryRun: false })
    expect(db.getWaiting(fact.id)?.replyDeliveredAt).toBeNull()
    expect(service.note(fact)).toEqual({ hold: false, why: null })
    expect(delivered).toEqual([])
  })

  it('tells the bell to look again once a held answer is sorted for the chat', async () => {
    const changed = vi.fn()
    const service = createHqReplyRouting({ ...routingDeps(), changed })
    const fact = answered('Postgres, the replica is read-only')
    expect(service.note(fact)).toEqual({ hold: true, why: null })
    judge.mockResolvedValueOnce('CHAT')
    await service.route(null, { dryRun: false })
    expect(changed).toHaveBeenCalled()
    expect(service.note(fact)).toEqual({ hold: false, why: null })
  })

  // 09.11: «спасибо, всё супер» became a «Pass to chat» card — a thanks is nobody's work.
  it('handles a thanks with no card and keeps the waiting open for a real answer', async () => {
    const service = routing()
    const thanks = answered('Thank you so much, it all adds up! ❤️')
    judge.mockResolvedValueOnce('NOISE')
    expect(service.note(thanks)).toEqual({ hold: true, why: null })
    await service.route(null, { dryRun: false })
    const after = db.getWaiting(thanks.id)
    expect(after?.replyDeliveredAt).not.toBeNull()
    expect(after?.status).toBe('open')
    expect(decisions()).toEqual([
      expect.objectContaining({
        needs: 'nobody',
        status: 'done',
        title: expect.stringContaining('thanks')
      })
    ])
    expect(delivered).toEqual([])
  })
})
