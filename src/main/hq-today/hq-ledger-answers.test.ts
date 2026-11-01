import { describe, expect, it, vi } from 'vitest'
import type { HqLedgerAnswer } from '../../shared/hq-ledger'
import type { PulseWaiting } from '../../shared/pulse-types'
import {
  createHqLedgerAnswers,
  hqLedgerAnswersLine,
  hqLedgerClickUpMessage
} from './hq-ledger-answers'
import type { HqSlackLedgerMessage } from './hq-slack-ledger-reader'

const OWNER = 'U_OWNER'
const BOB = 'U_BOB'
const DM = 'D0BOBDM01'
const T0 = 1_790_000_000_000

function waiting(over: Partial<PulseWaiting>): PulseWaiting {
  return {
    id: 'w-1',
    direction: 'on-them',
    personId: 'p-bob',
    project: 'acme',
    title: 'Is the import done?',
    detail: null,
    source: 'agent',
    sourceRef: null,
    status: 'open',
    dueAt: null,
    resolution: null,
    createdAt: T0,
    resolvedAt: null,
    agentSessionId: null,
    paneKey: null,
    worktreeId: null,
    reply: null,
    replyAuthor: null,
    replyTs: null,
    repliedAt: null,
    replyDeliveredAt: null,
    ...over
  }
}

const ts = (ms: number): string => (ms / 1000).toFixed(6)

function message(over: Partial<HqSlackLedgerMessage> & { at: number }): HqSlackLedgerMessage {
  const { at, ...rest } = over
  return {
    channel: DM,
    ts: ts(at),
    threadTs: null,
    user: BOB,
    text: 'yes, done',
    rawText: 'yes, done',
    permalink: null,
    dm: true,
    bot: false,
    ...rest
  }
}

function setup(open: PulseWaiting[], over: { isAnswer?: boolean; pick?: number | null } = {}) {
  const recorded: HqLedgerAnswer[] = []
  let now = T0 + 60 * 60_000
  const isAnswer = vi.fn(async () => over.isAnswer ?? true)
  const pickAnswer = vi.fn(async () => (over.pick === undefined ? 0 : over.pick))
  const answers = createHqLedgerAnswers({
    listOpen: () => open,
    personSlackId: (id) => (id === 'p-bob' ? BOB : null),
    name: (id) => (id === BOB ? 'Bob' : null),
    judged: () => recorded,
    record: (answer) => void recorded.push(answer),
    isAnswer,
    pickAnswer,
    now: () => now
  })
  return {
    answers,
    recorded,
    isAnswer,
    pickAnswer,
    at: (ms: number) => {
      now = ms
    }
  }
}

describe('ledger answers in shadow', () => {
  it('takes a reply in the question thread without the model', async () => {
    const thread = 'slack:C0ACMEHUB1:1790000000.000100'
    const t = setup([waiting({ sourceRef: thread })])
    t.answers.seenSlack(
      message({
        at: T0 + 5 * 60_000,
        channel: 'C0ACMEHUB1',
        threadTs: '1790000000.000100',
        dm: false
      }),
      OWNER
    )
    expect(await t.answers.judge()).toBe(1)
    expect(t.recorded).toEqual([
      expect.objectContaining({ waitingId: 'w-1', ts: ts(T0 + 5 * 60_000), how: 'place' })
    ])
    expect(t.isAnswer).not.toHaveBeenCalled()
  })

  it('skips a thread reply addressed to someone else and a DM for a question asked in a channel', async () => {
    const thread = 'slack:C0ACMEHUB1:1790000000.000100'
    const t = setup([waiting({ sourceRef: thread })])
    t.answers.seenSlack(
      message({
        at: T0 + 5 * 60_000,
        channel: 'C0ACMEHUB1',
        threadTs: '1790000000.000100',
        dm: false,
        rawText: '<@U0ANN0001> can you check?'
      }),
      OWNER
    )
    t.answers.seenSlack(message({ at: T0 + 6 * 60_000 }), OWNER)
    expect(await t.answers.judge()).toBe(0)
    expect(t.recorded).toEqual([])
  })

  it('pairs a DM with the one question open to the person when the model says it answers', async () => {
    const t = setup([waiting({})])
    t.answers.seenSlack(message({ at: T0 + 5 * 60_000 }), OWNER)
    t.answers.seenSlack(message({ at: T0 + 6 * 60_000, user: OWNER }), OWNER)
    expect(await t.answers.judge()).toBe(1)
    expect(t.recorded[0]).toMatchObject({ how: 'dm', ts: ts(T0 + 5 * 60_000) })
    expect(t.isAnswer).toHaveBeenCalledWith('Is the import done?', 'Bob: yes, done')
  })

  it('records small talk as no answer and does not judge it again', async () => {
    const t = setup([waiting({})], { isAnswer: false })
    t.answers.seenSlack(message({ at: T0 + 5 * 60_000, text: 'thanks!' }), OWNER)
    expect(await t.answers.judge()).toBe(0)
    expect(t.recorded[0]).toMatchObject({ how: 'none', ts: null })
    // A restart's catch-up reads the same message again.
    t.answers.seenSlack(message({ at: T0 + 5 * 60_000, text: 'thanks!' }), OWNER)
    await t.answers.judge()
    expect(t.recorded).toHaveLength(1)
    expect(t.isAnswer).toHaveBeenCalledTimes(1)
  })

  it('lets the model pick one of several questions, and marks «which» when it cannot', async () => {
    const two = [
      waiting({ id: 'w-1', title: 'Is the import done?' }),
      waiting({ id: 'w-2', title: 'Can Acme ship on Monday?', createdAt: T0 + 1_000 })
    ]
    const picked = setup(two, { pick: 1 })
    picked.answers.seenSlack(message({ at: T0 + 5 * 60_000, text: 'Monday works' }), OWNER)
    expect(await picked.answers.judge()).toBe(1)
    expect(picked.pickAnswer).toHaveBeenCalledWith(
      ['Is the import done?', 'Can Acme ship on Monday?'],
      'Bob: Monday works'
    )
    expect(picked.recorded.map((a) => [a.waitingId, a.how, a.ts])).toEqual([
      ['w-1', 'none', null],
      ['w-2', 'pick', ts(T0 + 5 * 60_000)]
    ])
    expect(picked.isAnswer).not.toHaveBeenCalled()

    const unsure = setup(two, { pick: null })
    unsure.answers.seenSlack(message({ at: T0 + 5 * 60_000, text: 'hm' }), OWNER)
    expect(await unsure.answers.judge()).toBe(0)
    expect(unsure.recorded.map((a) => a.how)).toEqual(['which', 'which'])
  })

  it('waits for the person to pause and takes the burst as one answer', async () => {
    const t = setup([waiting({ sourceRef: `slack:${DM}:1790000000.000100` })])
    const first = T0 + 5 * 60_000
    for (const offset of [0, 20_000, 40_000]) {
      t.answers.seenSlack(message({ at: first + offset, text: `part ${offset}` }), OWNER)
    }
    t.at(first + 50_000)
    expect(await t.answers.judge()).toBe(0)
    expect(t.recorded).toEqual([])
    t.at(first + 40_000 + 61_000)
    expect(await t.answers.judge()).toBe(1)
    expect(t.recorded[0]).toMatchObject({
      ts: ts(first + 40_000),
      messages: [ts(first), ts(first + 20_000), ts(first + 40_000)]
    })
    expect(t.isAnswer).toHaveBeenCalledTimes(1)
  })

  it('pairs a ClickUp comment the reply reader read under the question', async () => {
    const t = setup([waiting({ sourceRef: 'clickup:DEV-1:c-1' })])
    const comment = (id: string, at: number) =>
      hqLedgerClickUpMessage({ id, body: ' Done ', createdAt: at, author: { id: '42' } }, 'abc1')
    t.answers.seenClickUp('w-1', [comment('c-2', T0 + 60_000), comment('c-3', T0 + 120_000)])
    expect(await t.answers.judge()).toBe(1)
    expect(t.recorded[0]).toMatchObject({ how: 'place', ts: ts(T0 + 120_000) })
    expect(t.isAnswer).not.toHaveBeenCalled()
    // The next ClickUp read lists the same comments again.
    t.answers.seenClickUp('w-1', [comment('c-2', T0 + 60_000), comment('c-3', T0 + 120_000)])
    expect(await t.answers.judge()).toBe(0)
    expect(t.recorded).toHaveLength(1)
  })

  it('drops what waits on a question that was closed meanwhile', async () => {
    const open = [waiting({})]
    const t = setup(open)
    t.answers.seenSlack(message({ at: T0 + 5 * 60_000 }), OWNER)
    open.length = 0
    expect(await t.answers.judge()).toBe(0)
    expect(t.recorded).toEqual([])
  })
})

describe('the day line', () => {
  const now = T0 + 20 * 60 * 60_000
  const answer = (over: Partial<HqLedgerAnswer>): HqLedgerAnswer => ({
    waitingId: 'w-1',
    ts: ts(T0),
    messages: [ts(T0)],
    how: 'dm',
    at: T0,
    ...over
  })

  it('counts matched, ledger-only, reader-only and «which», a cut burst matching', () => {
    const line = hqLedgerAnswersLine(
      [
        answer({ ts: ts(T0 + 2_000), messages: [ts(T0), ts(T0 + 2_000)] }),
        answer({ waitingId: 'w-2aaaaaaaa', ts: ts(T0 + 5_000), messages: [ts(T0 + 5_000)] }),
        answer({ waitingId: 'w-4', ts: null, how: 'which', messages: [ts(T0 + 7_000)] })
      ],
      [
        { waitingId: 'w-1', ts: ts(T0), authorId: 'U_BOB' },
        { waitingId: 'w-3bbbbbbbb', ts: ts(T0 + 9_000), authorId: 'U_BOB' },
        { waitingId: 'w-5', ts: ts(T0 + 9_000), authorId: 'gitlab' }
      ],
      now
    )
    expect(line).toBe(
      `Answers, ledger vs reply reader (24 h): 1 matched; only ledger 1 (w-2aaaaa@${ts(T0 + 5_000)}); only reader 1 (w-3bbbbb@${ts(T0 + 9_000)}); «which» 1`
    )
  })

  it('leaves out pairs younger than ten minutes and older than a day', () => {
    const line = hqLedgerAnswersLine(
      [answer({ ts: ts(now - 60_000), messages: [ts(now - 60_000)] })],
      [{ waitingId: 'w-9', ts: ts(now - 30 * 60 * 60_000), authorId: null }],
      now
    )
    expect(line).toBe(
      'Answers, ledger vs reply reader (24 h): 0 matched; only ledger 0; only reader 0; «which» 0'
    )
  })
})
