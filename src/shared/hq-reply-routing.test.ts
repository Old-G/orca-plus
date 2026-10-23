import { describe, expect, it } from 'vitest'
import {
  hqReplyCardNote,
  hqReplyPrechecks,
  hqReplyVerdictReasons,
  parseHqReplyVerdict,
  type HqReplyVerdict
} from './hq-reply-routing'
import type { PulseWaiting } from './pulse-types'

const DM = 'slack:D0AAAAAAAAA:1792184200.000100'
const DM_REPLY = 'https://acme.slack.com/archives/D0AAAAAAAAA/p1792184300000100'

function waiting(change: Partial<PulseWaiting> = {}): PulseWaiting {
  return {
    id: 'w1',
    direction: 'on-them',
    personId: 'p-ann',
    project: 'acme-api',
    title: 'Which database holds the orders?',
    detail: null,
    source: 'slack',
    sourceRef: DM,
    status: 'open',
    dueAt: null,
    resolution: null,
    createdAt: 1,
    resolvedAt: null,
    agentSessionId: 'chat-1',
    paneKey: null,
    worktreeId: null,
    reply: 'The orders live in the reporting replica.',
    replyAuthor: 'Ann',
    replyTs: '1792184300.000100',
    repliedAt: 2,
    replyDeliveredAt: null,
    replyLink: DM_REPLY,
    ...change
  }
}

const clear: HqReplyVerdict = {
  answers: true,
  complete: true,
  asked: 1,
  answered: 1,
  money: false,
  prod: false,
  deadline: false,
  newRequest: false,
  question: false
}

describe('hqReplyPrechecks', () => {
  it('lets a plain answer said in the same DM through to the model', () => {
    expect(hqReplyPrechecks(waiting(), [])).toEqual([])
  })

  it('keeps an answer said elsewhere, in another channel thread or with no place a card', () => {
    const channel = 'slack:C0AAAAAAAAA:1792184200.000100'
    expect(
      hqReplyPrechecks(
        waiting({
          sourceRef: channel,
          replyLink:
            'https://acme.slack.com/archives/C0AAAAAAAAA/p1792184900000100?thread_ts=1792184800.000100'
        }),
        []
      )
    ).toEqual(['other-venue'])
    expect(
      hqReplyPrechecks(
        waiting({
          sourceRef: channel,
          replyLink:
            'https://acme.slack.com/archives/C0AAAAAAAAA/p1792184900000100?thread_ts=1792184200.000100'
        }),
        []
      )
    ).toEqual([])
    expect(hqReplyPrechecks(waiting({ sourceRef: null, source: 'manual' }), [])).toEqual([
      'other-venue'
    ])
    expect(hqReplyPrechecks(waiting({ replyLink: null }), [])).toEqual(['other-venue'])
    expect(
      hqReplyPrechecks(
        waiting({
          sourceRef: 'clickup:ACME-12:900',
          replyLink: 'https://app.clickup.com/t/ACME-12?comment=901'
        }),
        []
      )
    ).toEqual([])
  })

  it('sends money, production, deadlines, counter-questions and shared messages to the owner', () => {
    const say = (reply: string) => hqReplyPrechecks(waiting({ reply }), [])
    expect(say('Refund is 40 USD')).toEqual(['money'])
    expect(say('Оплата прошла вчера')).toEqual(['money'])
    expect(say('Выкатил на прод')).toEqual(['prod'])
    expect(say('Сделаю до пятницы')).toEqual(['deadline'])
    expect(say('Which one do you mean?')).toEqual(['counter-question'])
    // Why: whole words only — a product or an estimate is not money or production.
    expect(say('Оценка готова, продукт в каталоге')).toEqual([])
    expect(hqReplyPrechecks(waiting({ agentSessionId: null }), [])).toEqual(['no-chat'])
    const twin = waiting({ id: 'w2', title: 'Another question' })
    expect(hqReplyPrechecks(waiting(), [waiting(), twin])).toEqual(['shared-message'])
  })
})

describe('the model verdict', () => {
  it('reads the JSON even with words around it, and refuses a half-filled one', () => {
    const text = `Sure: {"answers": true, "complete": false, "asked": 4, "answered": 2, "money": false, "prod": false, "deadline": false, "new_request": false, "question": false}`
    expect(parseHqReplyVerdict(text)).toEqual({ ...clear, complete: false, asked: 4, answered: 2 })
    expect(parseHqReplyVerdict('{"answers": true}')).toBeNull()
    expect(parseHqReplyVerdict('no json here')).toBeNull()
    expect(parseHqReplyVerdict('{"answers": "yes", "complete": true}')).toBeNull()
  })

  it('passes only a complete answer with no flags, and says why otherwise', () => {
    expect(hqReplyVerdictReasons(clear)).toEqual([])
    expect(hqReplyVerdictReasons({ ...clear, complete: false, asked: 4, answered: 2 })).toEqual([
      'partial'
    ])
    expect(hqReplyVerdictReasons({ ...clear, answers: false, newRequest: true })).toEqual([
      'not-an-answer',
      'new-request'
    ])
    expect(hqReplyCardNote(['partial', 'money'], '2 of 4')).toBe(
      'Not passed by itself: partial answer (2 of 4), money.'
    )
  })
})
