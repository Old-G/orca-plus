import { describe, expect, it } from 'vitest'
import { canAdoptStrata, classifyStrataStatus, type StrataFileProbe } from './strata-status'

function probe(files: Record<string, boolean | null>): StrataFileProbe {
  return async (relativePath) => (relativePath in files ? files[relativePath] : false)
}

describe('classifyStrataStatus', () => {
  it('is full with WIKI.md and wiki/index.md, CLAUDE.md or not', async () => {
    expect(await classifyStrataStatus(probe({ 'WIKI.md': true, 'wiki/index.md': true }))).toBe(
      'full'
    )
  })

  it('is claude-md with CLAUDE.md but an incomplete wiki', async () => {
    expect(await classifyStrataStatus(probe({ 'CLAUDE.md': true, 'WIKI.md': true }))).toBe(
      'claude-md'
    )
  })

  it('is none when the host answered and nothing is there', async () => {
    expect(await classifyStrataStatus(probe({}))).toBe('none')
  })

  it('is unknown, not none, when any file could not be checked', async () => {
    expect(await classifyStrataStatus(probe({ 'WIKI.md': null }))).toBe('unknown')
  })

  it('still reports what it could see when another probe failed', async () => {
    expect(await classifyStrataStatus(probe({ 'CLAUDE.md': true, 'WIKI.md': null }))).toBe(
      'claude-md'
    )
  })
})

describe('canAdoptStrata', () => {
  it('offers adoption only for a readable project that is not full yet', () => {
    expect(canAdoptStrata('none')).toBe(true)
    expect(canAdoptStrata('claude-md')).toBe(true)
    expect(canAdoptStrata('full')).toBe(false)
    expect(canAdoptStrata('unknown')).toBe(false)
    expect(canAdoptStrata(undefined)).toBe(false)
  })
})
