import { describe, expect, it } from 'vitest'
import type { HqLedgerSignal } from '../../shared/hq-ledger'
import { runHqLedgerShadow, type HqLedgerShadowDeps } from './hq-ledger-shadow'

const at = new Date(2026, 9, 30, 19, 0).getTime()
function deps(
  over: Partial<HqLedgerShadowDeps> = {}
): HqLedgerShadowDeps & { got: HqLedgerSignal[]; said: string[]; settled: string[] } {
  const got: HqLedgerSignal[] = []
  const said: string[] = []
  const settled: string[] = []
  return {
    got,
    said,
    settled,
    settle: (ts) => settled.push(ts),
    enabled: () => true,
    cards: () => [
      {
        kind: 'hq-intake',
        refId: JSON.stringify({
          channel: 'C0123HUBXY',
          ts: '1700000001.000100',
          threadTs: '1700000000.000100',
          author: 'Ann',
          text: 'hi'
        }),
        title: 'To work',
        createdAt: at - 1000
      },
      { kind: 'agent-finished', refId: '{}', title: 'x', createdAt: at - 500 }
    ],
    ingest: (signal) => got.push(signal),
    conversations: () => [{ state: 'you' }],
    waitingRef: () => null,
    personAuthorId: () => null,
    report: (did) => said.push(did),
    now: () => at,
    onError: (error) => {
      throw error
    },
    ...over
  }
}

describe('ledger shadow', () => {
  it('reads the readers’ cards into the ledger and reports once a day after 18:00', () => {
    const d = deps()
    const next = runHqLedgerShadow(d, { cursor: 0, reportedDay: null })
    expect(d.got.map((s) => s.key)).toEqual(['slack:C0123HUBXY:1700000000.000100'])
    expect(d.said).toEqual(['24 h in shadow: 1 cards → 1 conversations (1 your move)'])
    runHqLedgerShadow(d, next)
    expect(d.said).toHaveLength(1)
  })

  it('settles what the owner sent or skipped from a card, also when he did it after it was read', () => {
    const card = (ts: string, doneAt: number | null, doneAction: string | null) => ({
      kind: 'hq-intake',
      refId: JSON.stringify({ channel: 'C0123HUBXY', ts, author: 'Ann', text: 'hi' }),
      title: 'To work',
      createdAt: at - 1000,
      doneAt,
      doneAction
    })
    let cards = [
      card('1.1', null, null),
      card('2.2', at - 10, 'skipped'),
      card('3.3', at - 10, 'gone')
    ]
    const d = deps({ cards: () => cards })
    const next = runHqLedgerShadow(d, { cursor: 0, reportedDay: null })
    expect(d.got.map((s) => s.ts)).toEqual(['1.1', '2.2', '3.3'])
    // Why not «gone»: the mention cards go away when the conversation cards take their place.
    expect(d.settled).toEqual(['2.2'])
    cards = [card('1.1', at + 5, 'sent'), card('2.2', at - 10, 'skipped')]
    runHqLedgerShadow({ ...d, now: () => at + 60_000 }, next)
    expect(d.settled).toEqual(['2.2', '1.1'])
  })

  it('does not read the ledger’s own conversation cards back into it', () => {
    const d = deps({
      cards: () => [
        {
          kind: 'hq-intake',
          refId: JSON.stringify({ channel: 'C0123HUBXY', ts: '1.1', conversationId: 'c1' }),
          title: 'Ann: x',
          createdAt: at - 1000
        }
      ]
    })
    runHqLedgerShadow(d, { cursor: 0, reportedDay: null })
    expect(d.got).toEqual([])
  })
})
