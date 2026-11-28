import { describe, expect, it } from 'vitest'
import { hqPlusPalette } from './hq-plus-palette'

describe('hqPlusPalette', () => {
  it('is classic by default and for anything it does not know', () => {
    expect(hqPlusPalette(undefined)).toBe('classic')
    expect(hqPlusPalette(null)).toBe('classic')
    expect(hqPlusPalette({})).toBe('classic')
    expect(hqPlusPalette({ hqPlusPalette: 'neon' })).toBe('classic')
    expect(hqPlusPalette({ hqPlusPalette: 'classic' })).toBe('classic')
  })

  it('reads graphite', () => {
    expect(hqPlusPalette({ hqPlusPalette: 'graphite' })).toBe('graphite')
  })
})
