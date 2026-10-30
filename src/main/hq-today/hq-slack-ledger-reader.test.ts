import { afterEach, describe, expect, it } from 'vitest'
import { PulseDb } from '../orca-plus/pulse/pulse-db'
import type { HqLedgerGuess } from '../orca-plus/pulse/pulse-ledger'
import {
  hqLedgerSignalOfSlack,
  hqSlackParityLine,
  normalizeScoutId,
  runHqSlackLedgerReader,
  type HqSlackLedgerDeps,
  type HqSlackLedgerMessage
} from './hq-slack-ledger-reader'

const OWNER = 'U0OWNER'
const open: PulseDb[] = []
afterEach(() => {
  for (const db of open.splice(0)) {
    db.close()
  }
})

function message(over: Partial<HqSlackLedgerMessage>): HqSlackLedgerMessage {
  return {
    channel: 'C0123HUBXY',
    ts: '1700000100.000100',
    threadTs: '1700000000.000100',
    user: 'U_ANN',
    text: 'hi',
    rawText: 'hi',
    permalink: null,
    dm: false,
    bot: false,
    ...over
  }
}

function setup(messages: HqSlackLedgerMessage[], guess: HqLedgerGuess | null = null) {
  let id = 0
  const db = new PulseDb(':memory:', { now: () => 1_000, newId: () => `id-${++id}` })
  open.push(db)
  const guessed: string[] = []
  const deps: HqSlackLedgerDeps = {
    enabled: () => true,
    read: (run) =>
      run({
        owner: OWNER,
        withOwner: async () => messages,
        name: async (user) => (user === 'U_ANN' ? 'Ann' : user)
      }),
    ingest: (signal) => db.ingestLedgerSignal(signal),
    lastDirection: (key) => db.lastLedgerDirection(key),
    guess: async (m) => {
      guessed.push(m.ts)
      return guess
    },
    setGuess: (conversationId, value) => db.setLedgerGuess(conversationId, value),
    now: () => 1_700_000_200_000
  }
  return { db, deps, guessed }
}

describe('Slack ledger reader', () => {
  it('turns a thread with the owner into one conversation, his move once he is answered', async () => {
    const { db, deps, guessed } = setup([
      message({ ts: '1700000050.000100', user: 'U_ANN', text: 'reply', rawText: 'reply' }),
      message({ ts: '1700000000.000100', threadTs: null, user: OWNER, text: 'question' })
    ])
    const state = await runHqSlackLedgerReader(deps, { cursor: 0, delays: [] })
    const [conversation] = db.listLedgerConversations()
    expect(conversation).toMatchObject({ key: 'slack:C0123HUBXY:1700000000.000100', messages: 2 })
    // Why: Ann answers the owner, who wrote last.
    expect(conversation?.state).toBe('you')
    expect(guessed).toEqual(['1700000000.000100'])
    expect(state.cursor).toBe(1_700_000_050_000)
    expect(state.delays).toEqual([])
  })

  it('reads the same messages twice into nothing new, and measures the delay after the first pass', async () => {
    const { db, deps } = setup([message({})])
    const first = await runHqSlackLedgerReader(deps, { cursor: 1, delays: [] })
    const second = await runHqSlackLedgerReader(deps, first)
    expect(db.listLedgerConversations()).toHaveLength(1)
    expect(first.delays).toEqual([100])
    expect(second.delays).toEqual([100])
  })

  it('leaves a lone top-level channel line alone but keeps DMs and posts that mention the owner', async () => {
    const { db, deps } = setup([
      message({ ts: '1700000001.000000', threadTs: null, user: OWNER, text: 'news for all' }),
      message({ channel: 'D0123HUBXY', ts: '1700000002.000000', threadTs: null, dm: true }),
      message({
        channel: 'C0456HUBXY',
        ts: '1700000003.000000',
        threadTs: null,
        rawText: `Summary: <@${OWNER}> connects the logs`
      })
    ])
    await runHqSlackLedgerReader(deps, { cursor: 0, delays: [] })
    expect(db.listLedgerConversations().map((c) => [c.key, c.state])).toEqual([
      ['slack:D0123HUBXY:1700000002.000000', 'you'],
      ['slack:C0456HUBXY:1700000003.000000', 'you']
    ])
  })

  it('takes the small model’s project and gist, but not «fyi» over a DM to the owner', async () => {
    const { db, deps } = setup([message({ channel: 'D0123HUBXY', threadTs: null, dm: true })], {
      project: 'acme-hub',
      how: 'model',
      state: 'fyi',
      gist: 'Спасибо за вчера'
    })
    await runHqSlackLedgerReader(deps, { cursor: 0, delays: [] })
    expect(db.listLedgerConversations()[0]).toMatchObject({
      project: 'acme-hub',
      state: 'you',
      title: 'Спасибо за вчера'
    })
  })
})

describe('hqLedgerSignalOfSlack', () => {
  it('skips bots and marks only what is said to the owner as his', () => {
    expect(hqLedgerSignalOfSlack(message({ bot: true }), OWNER, null, null)).toBeNull()
    expect(hqLedgerSignalOfSlack(message({}), OWNER, 'Ann', null)?.forOwner).toBe(false)
    expect(
      hqLedgerSignalOfSlack(message({ rawText: `<@${OWNER}> look` }), OWNER, 'Ann', null)?.forOwner
    ).toBe(true)
    expect(
      hqLedgerSignalOfSlack(message({ rawText: '<@U0BOB> look' }), OWNER, 'Ann', 'out')
    ).toMatchObject({ forOwner: false, reader: 'slack-api' })
    expect(hqLedgerSignalOfSlack(message({ user: OWNER }), OWNER, 'Me', 'in')).toMatchObject({
      fromOwner: true,
      forOwner: false
    })
  })
})

describe('parity with the scout', () => {
  it('names what the scout saw and the ledger did not, and the delay', () => {
    const line = hqSlackParityLine(
      ['C1:1.1', 'C1:2.2', 'D1:3.3'],
      (channel, ts) => channel === 'C1' && ts === '1.1',
      [10, 40, 70]
    )
    expect(line).toBe(
      'Slack API vs scout: 1 of 3 in conversations, missing C1:2.2, D1:3.3; delay median 40 s, max 70 s over 3'
    )
    expect(normalizeScoutId('C05Q0V2JBKK:1793359387819889')).toBe('C05Q0V2JBKK:1793359387.819889')
    expect(normalizeScoutId('C05Q0V2JBKK:1793359387.819889')).toBe('C05Q0V2JBKK:1793359387.819889')
  })

  it('finds a DM line that joined the day’s talk', () => {
    const db = new PulseDb(':memory:', { now: () => 1_000, newId: () => 'c1' })
    open.push(db)
    db.ingestLedgerSignal({
      key: 'slack:D0123HUBXY:1700000000.000100',
      ts: '1700000500.000100',
      at: 1_700_000_500_000,
      author: 'Ann',
      authorId: 'U_ANN',
      fromOwner: false,
      text: 'hi',
      link: null,
      reader: 'slack-api',
      forOwner: true,
      project: null,
      title: 'hi'
    })
    expect(db.ledgerHasSlackMessage('D0123HUBXY', '1700000000.000100')).toBe(true)
    expect(db.ledgerHasSlackMessage('D0123HUBXY', '1700000500.000100')).toBe(true)
    expect(db.ledgerHasSlackMessage('D0123HUBXY', '1700000900.000100')).toBe(false)
  })
})
