import { describe, expect, it } from 'vitest'
import type { PulseWaiting, PulseWaitingInput } from '../../shared/pulse-types'
import type { HqLedgerOwnLine } from '../orca-plus/pulse/pulse-ledger-promises'
import {
  HQ_LEDGER_PROMISE_CALLS_PER_DAY,
  hqLedgerPromisesPrompt,
  hqPromiseLinkKey,
  parseHqLedgerPromises,
  runHqLedgerPromises,
  type HqLedgerPromisesDeps
} from './hq-ledger-promises'

const NOW = new Date(2026, 10, 3, 15, 0).getTime()
const LINK = 'https://acme.slack.com/archives/D0ANN/p1700000060000100'

function own(over: Partial<HqLedgerOwnLine> = {}): HqLedgerOwnLine {
  return {
    conversationId: 'c1',
    key: 'slack:D0ANN:1700000000.000100',
    ts: '1700000060.000100',
    text: 'Гляну сегодня вечером и пришлю',
    link: LINK,
    at: NOW - 60_000,
    project: 'acme-shop',
    peer: 'Ann',
    peerId: 'U_ANN',
    peerText: 'Can you check the export?',
    ...over
  }
}

function setup(
  lines: HqLedgerOwnLine[],
  answer: string | null,
  waitings: Partial<PulseWaiting>[] = []
) {
  const added: PulseWaitingInput[] = []
  const looked: number[] = []
  const prompts: string[] = []
  const deps: HqLedgerPromisesDeps = {
    enabled: () => true,
    ownLines: (since) => lines.filter((entry) => entry.at > since),
    lookedUpTo: () => looked.at(-1) ?? null,
    looked: (upTo) => looked.push(upTo),
    looksSince: () => looked.length,
    listWaitings: () => waitings as PulseWaiting[],
    personFor: (name) => `person:${name}`,
    addWaiting: (input) => added.push(input),
    generate: async (prompt) => {
      prompts.push(prompt)
      return answer === null ? { ok: false, error: 'down' } : { ok: true, text: answer }
    },
    now: () => NOW
  }
  return { deps, added, looked, prompts }
}

// Custom build (hq-ledger-promises, plan 20.9): the owner's promises from the ledger, not the scout.
describe('promises from the ledger', () => {
  it('records a promise to the person he answered, once, and reads each line once', async () => {
    const { deps, added, looked, prompts } = setup(
      [own()],
      '{"promises": [{"n": 1, "what": "Проверить экспорт и прислать Ann", "due": "2026-11-03"}]}'
    )
    expect(await runHqLedgerPromises(deps)).toBe(1)
    expect(added).toEqual([
      expect.objectContaining({
        direction: 'on-me',
        title: 'Проверить экспорт и прислать Ann',
        personId: 'person:Ann',
        project: 'acme-shop',
        source: 'slack-promise',
        sourceRef: LINK
      })
    ])
    expect(added[0]?.dueAt).toBeGreaterThan(0)
    expect(looked).toEqual([NOW - 60_000])
    expect(await runHqLedgerPromises(deps)).toBe(0)
    expect(prompts).toHaveLength(1)
  })

  it('does not record one the scout already recorded under its own link to the same message', async () => {
    const { deps, added } = setup(
      [own()],
      '{"promises": [{"n": 1, "what": "Check the export", "due": ""}]}',
      [{ sourceRef: `${LINK}?thread_ts=1700000000.000100&cid=D0ANN` }]
    )
    expect(await runHqLedgerPromises(deps)).toBe(0)
    expect(added).toEqual([])
  })

  it('reads a failed call again next time, skips a talk with nobody in it, and keeps to the day', async () => {
    const failing = setup([own()], null)
    expect(await runHqLedgerPromises(failing.deps)).toBe(0)
    expect(failing.looked).toEqual([NOW - 2 * 24 * 60 * 60_000])
    const alone = setup([own({ peer: null, peerId: null, peerText: null })], '{"promises": []}')
    expect(await runHqLedgerPromises(alone.deps)).toBe(0)
    expect(alone.prompts).toEqual([])
    expect(alone.looked).toEqual([NOW - 60_000])
    const spent = setup([own()], '{"promises": []}')
    expect(
      await runHqLedgerPromises({
        ...spent.deps,
        looksSince: () => HQ_LEDGER_PROMISE_CALLS_PER_DAY
      })
    ).toBe(0)
    expect(spent.prompts).toEqual([])
  })

  it('quotes both sides and reads only promises that point at a message it was given', () => {
    const prompt = hqLedgerPromisesPrompt([own({ peerText: 'see """ this' })], '2026-11-03')
    expect(prompt).toContain('[1] Ann before: see " this')
    expect(prompt).toContain('[1] the user: Гляну сегодня вечером и пришлю')
    expect(
      parseHqLedgerPromises(
        '{"promises": [{"n": 2, "what": "x"}, {"n": 1, "what": "y", "due": "soon"}]}',
        1
      )
    ).toEqual([{ n: 1, what: 'y', due: null }])
    expect(hqPromiseLinkKey(LINK)).toBe('slack:D0ANN:1700000060000100')
  })
})
