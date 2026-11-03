import { afterEach, describe, expect, it } from 'vitest'
import { PulseDb } from '../orca-plus/pulse/pulse-db'
import type { HqLedgerGuess } from '../orca-plus/pulse/pulse-ledger'
import {
  hqLedgerSignalOfSlack,
  runHqSlackLedgerReader,
  type HqSlackLedgerDeps,
  type HqSlackLedgerMessage
} from './hq-slack-ledger-reader'
import { hqSlackParityLine, normalizeScoutId } from './hq-slack-parity'

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

  it('shows the ledger’s answers every message it read, the ones already in the ledger too', async () => {
    const { deps } = setup([
      message({ ts: '1700000050.000100', user: 'U_ANN', text: 'reply', rawText: 'reply' }),
      message({ ts: '1700000000.000100', threadTs: null, user: OWNER, text: 'question' })
    ])
    const seen: string[] = []
    const withAnswers = {
      ...deps,
      answers: {
        seenSlack: (m: HqSlackLedgerMessage, owner: string) => seen.push(`${owner}:${m.ts}`),
        judge: async () => 0
      }
    }
    const state = await runHqSlackLedgerReader(withAnswers, { cursor: 0, delays: [] })
    await runHqSlackLedgerReader(withAnswers, state)
    expect(seen).toEqual([
      `${OWNER}:1700000000.000100`,
      `${OWNER}:1700000050.000100`,
      `${OWNER}:1700000000.000100`,
      `${OWNER}:1700000050.000100`
    ])
  })

  it('reads the same messages twice into nothing new, and measures the delay after the first pass', async () => {
    const { db, deps } = setup([message({ rawText: `<@${OWNER}> hi` })])
    const first = await runHqSlackLedgerReader(deps, { cursor: 1, delays: [] })
    const second = await runHqSlackLedgerReader(deps, first)
    expect(db.listLedgerConversations()).toHaveLength(1)
    expect(first.delays).toEqual([100])
    expect(second.delays).toEqual([100])
  })

  it('does not count as late a line said before the owner was in the talk', async () => {
    // Why (03.11, max 1958 s): search finds a thread's earlier lines once the owner joins it.
    const { deps } = setup([message({})])
    const state = await runHqSlackLedgerReader(deps, { cursor: 1, delays: [] })
    expect(state.delays).toEqual([])
  })

  it('measures the delay when the message reached the ledger, not after the model looked at it', async () => {
    const { deps } = setup([
      message({ ts: '1700000100.000100', rawText: `<@${OWNER}> one` }),
      message({
        ts: '1700000150.000100',
        threadTs: '1700000150.000100',
        rawText: `<@${OWNER}> two`
      })
    ])
    let clock = 1_700_000_200_000
    const state = await runHqSlackLedgerReader(
      {
        ...deps,
        now: () => clock,
        // Why: a slow model must not add its time to the next message's delay.
        guess: async () => {
          clock += 120_000
          return null
        }
      },
      { cursor: 1, delays: [] }
    )
    expect(state.delays).toEqual([100, 50])
    expect(state.slowest).toEqual({ seconds: 100, id: 'C0123HUBXY:1700000100.000100' })
  })

  it('counts a pass after a long gap as a catch-up, not as delays', async () => {
    const { deps } = setup([message({})])
    // Why: the last good pass was 10 minutes before this one (no network, the Mac asleep).
    const state = await runHqSlackLedgerReader(deps, {
      cursor: 1,
      delays: [],
      passAt: 1_700_000_200_000 - 600_000
    })
    expect(state.delays).toEqual([])
    expect(state.gaps).toEqual([600])
    expect(state.passAt).toBe(1_700_000_200_000)
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

  it('keeps «fyi» when the owner answered in the same pass, whatever the model says', async () => {
    const { db, deps } = setup(
      [
        message({ ts: '1700000002.000000', user: OWNER, text: 'ok' }),
        message({ ts: '1700000001.000000', user: 'U_ANN', text: 'fyi: deployed' })
      ],
      { project: null, how: 'model', state: 'you', gist: null }
    )
    await runHqSlackLedgerReader(deps, { cursor: 0, delays: [] })
    expect(db.listLedgerConversations()[0]?.state).toBe('fyi')
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
  it('compares the topics the scout raised, not the messages it skipped, and the delay', () => {
    const line = hqSlackParityLine(
      [
        { id: 'C1:1.1', messages: ['C1:1.1', 'C1:1.5'] },
        // Why: one message of a topic in the ledger is enough — the scout groups threads across channels.
        { id: 'C2:2.2', messages: ['C2:2.2', 'C1:1.5'] },
        { id: 'D1:3.3', messages: ['D1:3.3'] }
      ],
      (channel, ts) => channel === 'C1' && ts === '1.5',
      [10, 40, 70]
    )
    expect(line).toBe(
      'Slack API vs scout: 2 of 3 topics in conversations, missing D1:3.3; delay median 40 s, max 70 s over 3, 1 over 1 min'
    )
  })

  it('holds quiet topics apart, names the slowest message and the scout cards', () => {
    const line = hqSlackParityLine(
      [
        { id: 'C1:1.1', messages: ['C1:1.1'] },
        // Why: the scout files colleagues' talks it read for context as quiet; not said to the owner.
        { id: 'C2:2.2', messages: ['C2:2.2'], quiet: true },
        { id: 'D1:3.3', messages: ['D1:3.3'], quiet: true }
      ],
      (channel) => channel !== 'C2',
      [20, 30, 95],
      [],
      {
        slowest: { seconds: 95, id: 'D1:4.4' },
        cards: { cards: 4, held: 3, sameKind: 2, drafted: 3 }
      }
    )
    expect(line).toBe(
      'Slack API vs scout: 1 of 1 topics in conversations; quiet: 1 of 2 (the rest not said to you); ' +
        "scout cards: 3 of 4 held, kind as the scout's 2 of 3, reply drafted 3 of 3; " +
        'delay median 30 s, max 95 s (D1:4.4) over 3, 1 over 1 min'
    )
  })

  it('names a catch-up after a gap apart from the delay', () => {
    expect(hqSlackParityLine([], () => true, [], [600, 19_300])).toBe(
      'Slack API vs scout: 0 of 0 topics in conversations; no new messages read; 2 catch-ups after up to 322 min without Slack'
    )
  })

  it('reads a scout id written without the dot', () => {
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
    expect(db.ledgerShadow.hasSlackMessage('D0123HUBXY', '1700000000.000100')).toBe(true)
    expect(db.ledgerShadow.hasSlackMessage('D0123HUBXY', '1700000500.000100')).toBe(true)
    expect(db.ledgerShadow.hasSlackMessage('D0123HUBXY', '1700000900.000100')).toBe(false)
  })
})

// Custom build (hq-ledger-context, owner 03.11): plan stage 20.2, scenarios С1 and С2.
describe('Slack ledger reader context', () => {
  const ROOT = '1700000000.000100'
  function withApi(
    found: HqSlackLedgerMessage[],
    api: {
      thread?: (channel: string, threadTs: string) => Promise<HqSlackLedgerMessage[]>
      dmBefore?: () => Promise<HqSlackLedgerMessage[]>
    }
  ) {
    const base = setup(found)
    const contexts: string[][] = []
    const deps: HqSlackLedgerDeps = {
      ...base.deps,
      read: (run) =>
        run({
          owner: OWNER,
          withOwner: async () => found,
          name: async (user) => (user === 'U_ANN' ? 'Ann' : user === 'U_BOB' ? 'Bob' : user),
          ...api
        }),
      guess: async (_message, _author, _fromOwner, context) => {
        contexts.push(context.map((line) => `${line.author}: ${line.text}`))
        return null
      }
    }
    return { ...base, deps, contexts }
  }

  it('С2: a mention halfway down a channel thread brings the whole thread, root first', async () => {
    const mention = message({
      ts: '1700000100.000100',
      text: '@owner can you check?',
      rawText: `<@${OWNER}> can you check?`
    })
    const whole = [
      message({
        ts: ROOT,
        threadTs: ROOT,
        user: 'U_BOB',
        text: 'Export to CSV breaks on big files'
      }),
      message({ ts: '1700000050.000100', text: 'same for me' }),
      mention
    ]
    const { db, deps, contexts } = withApi([mention], { thread: async () => whole })

    const state = await runHqSlackLedgerReader(deps, { cursor: 1_700_000_000_000, delays: [] })

    const [conversation] = db.listLedgerConversations()
    expect(conversation).toMatchObject({
      key: `slack:C0123HUBXY:${ROOT}`,
      messages: 3,
      title: 'Export to CSV breaks on big files',
      state: 'you'
    })
    expect(contexts).toEqual([['Ann: same for me', 'Ann: @owner can you check?']])
    // Why: the thread's older lines were read whole, not late.
    expect(state.delays).toHaveLength(1)
  })

  it('a thread that cannot be read leaves the message as it was found', async () => {
    const mention = message({ rawText: `<@${OWNER}> look`, text: 'look' })
    const { db, deps } = withApi([mention], {
      thread: async () => {
        throw new Error('ratelimited')
      }
    })

    await runHqSlackLedgerReader(deps, { cursor: 0, delays: [] })

    expect(db.listLedgerConversations()[0]).toMatchObject({ messages: 1, state: 'you' })
  })

  // Why (Codex 03.11): a thread its pass could not read is read on a later one, and its older lines
  // do not change whose move it is.
  it('reads a thread whose read failed on the next pass, its move unchanged', async () => {
    const mention = message({ rawText: `<@${OWNER}> look`, text: 'look' })
    const root = message({ ts: ROOT, threadTs: ROOT, user: 'U_BOB', text: 'Export breaks' })
    let fail = true
    const { db, deps } = withApi([mention], {
      thread: async () => {
        if (fail) {
          throw new Error('ratelimited')
        }
        return [root, mention]
      }
    })

    const first = await runHqSlackLedgerReader(deps, { cursor: 0, delays: [] })
    expect(first.threads?.pending).toHaveLength(1)
    fail = false
    const second = await runHqSlackLedgerReader(
      { ...deps, read: (run) => deps.read((api) => run({ ...api, withOwner: async () => [] })) },
      first
    )

    expect(second.threads).toEqual({ read: [`C0123HUBXY:${ROOT}`], pending: [] })
    expect(db.listLedgerConversations()[0]).toMatchObject({ messages: 2, state: 'you' })
  })

  // Why (Codex 03.11): the same message in the next search overlap must not restart the count.
  it('gives a thread up after five failed reads', async () => {
    const mention = message({ rawText: `<@${OWNER}> look`, text: 'look' })
    let calls = 0
    const { deps } = withApi([mention], {
      thread: async () => {
        calls += 1
        throw new Error('not_in_channel')
      }
    })

    let state: Awaited<ReturnType<typeof runHqSlackLedgerReader>> = { cursor: 0, delays: [] }
    for (let pass = 0; pass < 7; pass += 1) {
      state = await runHqSlackLedgerReader(deps, state)
    }

    expect(calls).toBe(5)
    expect(state.threads?.pending).toEqual([])
  })

  it('С1: a new DM talk is read with the DM lines before it', async () => {
    const ask = message({
      channel: 'D0123HUBXY',
      ts: '1700000300.000100',
      threadTs: null,
      dm: true,
      text: 'глянь, пожалуйста, ещё раз',
      rawText: 'глянь, пожалуйста, ещё раз'
    })
    const earlier = message({
      channel: 'D0123HUBXY',
      ts: '1700000000.000100',
      threadTs: null,
      dm: true,
      text: 'here is the MR: https://gitlab.com/acme/api/-/merge_requests/314'
    })
    const asked: unknown[] = []
    const { db, deps, contexts } = withApi([ask], {
      dmBefore: async (...args: unknown[]) => {
        asked.push(args)
        return [earlier]
      }
    })

    await runHqSlackLedgerReader(deps, { cursor: 0, delays: [] })

    expect(db.listLedgerConversations()).toHaveLength(1)
    expect(contexts).toEqual([
      ['Ann: here is the MR: https://gitlab.com/acme/api/-/merge_requests/314']
    ])
    expect(asked[0]).toEqual([
      'D0123HUBXY',
      '1700000300.000100',
      1_700_000_300_000 - 3 * 24 * 60 * 60_000,
      20
    ])
  })
})
