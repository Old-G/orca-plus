import { describe, expect, it } from 'vitest'
import { hqLedgerReplacesScout } from './hq-ledger-cutover'

describe('ledger cutover', () => {
  it('retires the scout only with the ledger on and its Slack reader working', () => {
    expect(hqLedgerReplacesScout({}, () => true)).toBe(true)
    expect(hqLedgerReplacesScout({}, () => false)).toBe(false)
    expect(hqLedgerReplacesScout({ hqLedger: 'shadow' }, () => true)).toBe(false)
  })
})
