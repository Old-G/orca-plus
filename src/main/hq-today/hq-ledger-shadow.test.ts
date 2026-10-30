import { describe, expect, it } from 'vitest'
import type { HqLedgerSignal } from '../../shared/hq-ledger'
import { runHqLedgerShadow, type HqLedgerShadowDeps } from './hq-ledger-shadow'

const at = new Date(2026, 9, 30, 19, 0).getTime()
function deps(
  over: Partial<HqLedgerShadowDeps> = {}
): HqLedgerShadowDeps & { got: HqLedgerSignal[]; said: string[] } {
  const got: HqLedgerSignal[] = []
  const said: string[] = []
  return {
    got,
    said,
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
})
