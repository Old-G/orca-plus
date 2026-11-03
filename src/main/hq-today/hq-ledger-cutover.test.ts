import { describe, expect, it } from 'vitest'
import { hqLedgerReplacesScout, noteHqLedgerReadSlack } from './hq-ledger-cutover'

describe('ledger cutover', () => {
  it('retires the scout only with the ledger on and its own last pass read Slack', () => {
    expect(hqLedgerReplacesScout({})).toBe(false)
    noteHqLedgerReadSlack(true)
    expect(hqLedgerReplacesScout({})).toBe(true)
    expect(hqLedgerReplacesScout({ hqLedger: 'shadow' })).toBe(false)
    noteHqLedgerReadSlack(false)
    expect(hqLedgerReplacesScout({})).toBe(false)
  })
})
