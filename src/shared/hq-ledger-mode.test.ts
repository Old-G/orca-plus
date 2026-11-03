import { describe, expect, it } from 'vitest'
import { hqLedgerMode } from './hq-ledger-mode'

describe('hqLedgerMode', () => {
  it('is on unless the owner chose shadow or off', () => {
    expect(hqLedgerMode(undefined)).toBe('on')
    expect(hqLedgerMode({})).toBe('on')
    expect(hqLedgerMode({ hqLedger: 'shadow' })).toBe('shadow')
    expect(hqLedgerMode({ hqLedger: 'off' })).toBe('off')
  })
})
