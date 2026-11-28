import { describe, expect, it } from 'vitest'
import { hqPlusDecor } from './hq-plus-decor'

describe('hqPlusDecor', () => {
  it('is full by default and for anything it does not know', () => {
    expect(hqPlusDecor(undefined)).toBe('full')
    expect(hqPlusDecor(null)).toBe('full')
    expect(hqPlusDecor({})).toBe('full')
    expect(hqPlusDecor({ hqPlusDecor: 'neon' })).toBe('full')
    expect(hqPlusDecor({ hqPlusDecor: 'full' })).toBe('full')
  })

  it('reads calm', () => {
    expect(hqPlusDecor({ hqPlusDecor: 'calm' })).toBe('calm')
  })
})
