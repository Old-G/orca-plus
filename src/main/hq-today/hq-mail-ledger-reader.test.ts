import { afterEach, describe, expect, it } from 'vitest'
import type { HqLetter } from '../../shared/hq-mail-events'
import { PulseDb } from '../orca-plus/pulse/pulse-db'
import type { HqLedgerGuess } from '../orca-plus/pulse/pulse-ledger'
import {
  hqLetterOwnWords,
  hqLetterSkipReason,
  hqLedgerSignalOfLetter,
  hqMailAddresses,
  hqMailLedgerQuery,
  hqMailSenderName,
  runHqMailLedgerReader,
  type HqMailLedgerDeps
} from './hq-mail-ledger-reader'

const NOW = Date.parse('2026-10-31T12:00:00Z')
const MIN = 60_000
const OWNER = 'owner@acme.example'

const open: PulseDb[] = []
afterEach(() => {
  for (const db of open.splice(0)) {
    db.close()
  }
})

function letter(over: Partial<HqLetter> = {}): HqLetter {
  return {
    id: 'm1',
    threadId: 't1',
    from: '"Ann Lee" <ann@acme.example>',
    to: `Owner <${OWNER}>`,
    cc: '',
    subject: 'Contract for November',
    body: 'Can you sign it by Monday?',
    receivedAt: NOW - 10 * MIN,
    listUnsubscribe: false,
    precedence: null,
    autoSubmitted: null,
    ...over
  }
}

function setup(inbox: HqLetter[], sent: HqLetter[] = [], guess: HqLedgerGuess | null = null) {
  let id = 0
  const db = new PulseDb(':memory:', { now: () => NOW, newId: () => `id-${++id}` })
  open.push(db)
  const fetched: string[] = []
  const guessed: string[] = []
  const queries: string[] = []
  const boxes = { inbox, sent }
  const all = () => [...boxes.inbox, ...boxes.sent]
  const deps: HqMailLedgerDeps = {
    enabled: () => true,
    owner: () => 'Owner@Acme.example',
    listRefs: async (query) => {
      queries.push(query)
      const box = query.startsWith('in:sent') ? boxes.sent : boxes.inbox
      return box
        .toSorted((a, b) => b.receivedAt - a.receivedAt)
        .map((item) => ({ id: item.id, threadId: item.threadId }))
    },
    getLetter: async (letterId) => {
      fetched.push(letterId)
      return all().find((item) => item.id === letterId) ?? null
    },
    ingest: (signal) => db.ingestLedgerSignal(signal),
    lastDirection: (key) => db.lastLedgerDirection(key),
    guess: async (item) => {
      guessed.push(item.id)
      return guess
    },
    setGuess: (conversationId, value) => db.setLedgerGuess(conversationId, value),
    now: () => NOW
  }
  const rows = () => db.listLedgerFeed(0).conversations
  return { db, deps, fetched, guessed, queries, rows, boxes }
}

describe('letters from people', () => {
  it('reads addresses and names the way mail writes them', () => {
    expect(
      hqMailAddresses('"Lee, Ann" <Ann@Acme.example>, bob@acme.example; Carol <c@acme.example>')
    ).toEqual(['ann@acme.example', 'bob@acme.example', 'c@acme.example'])
    expect(hqMailSenderName('"Ann Lee" <ann@acme.example>')).toBe('Ann Lee')
    expect(hqMailSenderName('ann@acme.example')).toBe('ann@acme.example')
    expect(hqMailLedgerQuery('inbox', 1_700_000_000_500)).toBe(
      'in:inbox category:primary after:1700000000'
    )
    expect(hqMailLedgerQuery('sent', 1_700_000_000_500)).toBe('in:sent after:1700000000')
  })

  it('leaves out the owner’s own, notices, robots and bulk mail', () => {
    const skip = (over: Partial<HqLetter>) => hqLetterSkipReason(letter(over), OWNER)
    expect(skip({})).toBeNull()
    expect(skip({ from: `Owner <${OWNER}>` })).toBe('own')
    expect(skip({ from: 'GitLab <gitlab@mg.gitlab.com>' })).toBe('notice')
    expect(skip({ from: 'Ann via ClickUp <a1b2@tasks.clickup.com>' })).toBe('notice')
    expect(skip({ from: 'Acme <no-reply@acme.example>' })).toBe('robot')
    expect(skip({ from: 'noreply@acme.example' })).toBe('robot')
    expect(skip({ from: 'MAILER-DAEMON@acme.example' })).toBe('robot')
    expect(skip({ from: 'Google Calendar <calendar-notification@google.com>' })).toBe('robot')
    expect(skip({ listUnsubscribe: true })).toBe('bulk')
    expect(skip({ precedence: ' Bulk ' })).toBe('bulk')
    expect(skip({ autoSubmitted: 'auto-replied' })).toBe('automatic')
    expect(skip({ autoSubmitted: 'no' })).toBeNull()
  })

  it('keeps the writer’s own words, not the quoted history', () => {
    expect(
      hqLetterOwnWords(
        'Signed, thanks.\r\n\r\nOn Fri, Oct 30, 2026 at 10:00 AM Owner <owner@acme.example>\r\nwrote:\r\n> Please sign'
      )
    ).toBe('Signed, thanks.')
    expect(hqLetterOwnWords('Yes.\n\n31 oct 2026, 10:00, Owner <owner@acme.example>:\n> ok')).toBe(
      'Yes.'
    )
    expect(hqLetterOwnWords('On Monday we ship.\nSee you.')).toBe('On Monday we ship.\nSee you.')
  })

  it('makes a letter to the owner his move and a copy news, keyed by its thread', () => {
    expect(hqLedgerSignalOfLetter(letter({ subject: 'Re: RE: Contract' }), OWNER, false)).toEqual({
      key: 'gmail:t1',
      ts: 'm1',
      at: NOW - 10 * MIN,
      author: 'Ann Lee',
      authorId: 'ann@acme.example',
      fromOwner: false,
      text: 'Can you sign it by Monday?',
      link: 'https://mail.google.com/mail/?authuser=owner%40acme.example#all/t1',
      reader: 'gmail-letters',
      forOwner: true,
      project: null,
      title: 'Contract'
    })
    const copy = letter({ to: 'bob@acme.example', cc: OWNER })
    expect(hqLedgerSignalOfLetter(copy, OWNER, false).forOwner).toBe(false)
  })
})

describe('mail ledger reader', () => {
  it('reads the day’s letters into conversations, his move only when he is in To', async () => {
    const { deps, rows, queries, guessed } = setup([
      letter(),
      letter({
        id: 'm2',
        threadId: 't2',
        to: 'bob@acme.example',
        cc: OWNER,
        receivedAt: NOW - MIN
      }),
      letter({ id: 'm3', threadId: 't3', listUnsubscribe: true })
    ])
    const state = await runHqMailLedgerReader(deps, { cursor: 0, seen: [] })
    expect(rows().map((row) => [row.key, row.state])).toEqual([
      ['gmail:t1', 'you'],
      ['gmail:t2', 'fyi']
    ])
    expect(queries[0]).toBe(hqMailLedgerQuery('inbox', NOW - 24 * 60 * MIN))
    expect(guessed).toEqual(['m1', 'm2'])
    expect(state.cursor).toBe(NOW)
    expect(state.seen.toSorted()).toEqual(['m1', 'm2', 'm3'])
  })

  it('does not fetch a letter twice, and reads after the last pass', async () => {
    const { deps, fetched, queries } = setup([letter()])
    const first = await runHqMailLedgerReader(deps, { cursor: 0, seen: [] })
    await runHqMailLedgerReader(deps, first)
    expect(fetched).toEqual(['m1'])
    expect(queries.at(-2)).toBe(hqMailLedgerQuery('inbox', NOW - 30 * MIN))
  })

  it('closes his move with his reply in the thread, and reads no sent mail of other threads', async () => {
    const { deps, rows, fetched, boxes } = setup([letter()])
    await runHqMailLedgerReader(deps, { cursor: 0, seen: [] })
    boxes.sent = [
      letter({ id: 's1', from: `Owner <${OWNER}>`, to: 'ann@acme.example', receivedAt: NOW - MIN }),
      letter({ id: 's2', threadId: 't9', from: OWNER, to: 'bob@acme.example', receivedAt: NOW })
    ]
    await runHqMailLedgerReader(deps, { cursor: NOW, seen: ['m1'] })
    expect(fetched).toEqual(['m1', 's1'])
    expect(rows()).toMatchObject([{ key: 'gmail:t1', state: 'fyi' }])
    expect(rows()[0]?.messages.map((message) => message.direction)).toEqual(['in', 'out'])
  })

  it('reads his letter before the answer that came in the same pass, so the answer is his move', async () => {
    const { deps, rows, guessed } = setup(
      [letter({ id: 'm2', receivedAt: NOW - MIN, body: 'Done, see attached.' })],
      [letter({ id: 's1', from: OWNER, to: 'ann@acme.example', receivedAt: NOW - 20 * MIN })]
    )
    await runHqMailLedgerReader(deps, { cursor: 0, seen: [] })
    expect(rows()).toMatchObject([{ key: 'gmail:t1', state: 'you' }])
    expect(rows()[0]?.messages.map((message) => message.direction)).toEqual(['out', 'in'])
    expect(guessed).toEqual(['m2'])
  })

  it('lets the model raise a copy to his move and name the project', async () => {
    const guess: HqLedgerGuess = { project: 'acme-shop', how: 'model', state: 'you', gist: 'Счёт' }
    const { deps, rows } = setup([letter({ to: 'bob@acme.example', cc: OWNER })], [], guess)
    await runHqMailLedgerReader(deps, { cursor: 0, seen: [] })
    expect(rows()).toMatchObject([
      { key: 'gmail:t1', state: 'you', project: 'acme-shop', projectHow: 'model', title: 'Счёт' }
    ])
  })

  it('reads a long absence over several passes, holding the cursor until it caught up', async () => {
    const many = Array.from({ length: 35 }, (_, index) =>
      letter({ id: `m${index}`, threadId: `t${index}`, receivedAt: NOW - (40 - index) * MIN })
    )
    const { deps, fetched } = setup(many)
    const first = await runHqMailLedgerReader(deps, { cursor: 0, seen: [] })
    expect(first.cursor).toBe(0)
    expect(fetched).toHaveLength(30)
    expect(fetched[0]).toBe('m0')
    const second = await runHqMailLedgerReader(deps, first)
    expect(fetched).toHaveLength(35)
    expect(second.cursor).toBe(NOW)
  })

  it('does nothing while Gmail is not connected', async () => {
    const { deps, queries } = setup([letter()])
    deps.owner = () => null
    expect(await runHqMailLedgerReader(deps, { cursor: 5, seen: [] })).toEqual({
      cursor: 5,
      seen: []
    })
    expect(queries).toEqual([])
  })
})
