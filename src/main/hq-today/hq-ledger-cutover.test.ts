import { describe, expect, it } from 'vitest'
import { hqLedgerReplacesScout } from './hq-ledger-cutover'

describe('ledger cutover', () => {
  it('retires the scout only with the ledger on and the Slack reader connected', () => {
    expect(hqLedgerReplacesScout({}, () => true)).toBe(true)
    expect(hqLedgerReplacesScout({}, () => false)).toBe(false)
    expect(hqLedgerReplacesScout({ hqLedger: 'shadow' }, () => true)).toBe(false)
  })
})
