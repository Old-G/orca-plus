import { describe, expect, it } from 'vitest'
import { hqPlusTileFamilies, hqPlusTileOf } from './hq-plus-tile'

const PROJECTS = [
  'acme-agents',
  'acme_ai_brain',
  'acme-api',
  'acme_ai_code_reviewer',
  'acme-mcp-server-api',
  'acme-mcp-server-ledger',
  'acme-it-hub',
  'acme_support_ai_service',
  'orca-custom',
  'strata'
]

describe('HQ+ tile letters', () => {
  const families = hqPlusTileFamilies(PROJECTS)

  it('finds the first word several projects share', () => {
    expect([...families]).toEqual(['acme'])
  })

  it('takes the letters from the part of the name that differs', () => {
    expect(hqPlusTileOf('acme-agents', families)).toBe('AG')
    expect(hqPlusTileOf('acme_ai_brain', families)).toBe('BR')
    expect(hqPlusTileOf('acme-mcp-server-api', families)).toBe('API')
    expect(hqPlusTileOf('acme-mcp-server-ledger', families)).toBe('LE')
    expect(hqPlusTileOf('acme-it-hub', families)).toBe('IH')
    expect(hqPlusTileOf('acme_ai_code_reviewer', families)).toBe('CR')
    expect(hqPlusTileOf('acme_support_ai_service', families)).toBe('SA')
  })

  it('gives projects of one family different tiles', () => {
    const tiles = ['acme-agents', 'acme_ai_brain', 'acme_ai_code_reviewer', 'acme-it-hub'].map(
      (name) => hqPlusTileOf(name, families)
    )
    expect(new Set(tiles).size).toBe(tiles.length)
  })

  it('keeps the plain rule for a project outside a family', () => {
    expect(hqPlusTileOf('orca-custom', families)).toBe('OC')
    expect(hqPlusTileOf('strata', families)).toBe('ST')
    expect(hqPlusTileOf(null, families)).toBe('HQ')
  })

  it('never strips the whole name', () => {
    expect(hqPlusTileOf('acme', families)).toBe('AC')
    expect(hqPlusTileOf('mcp-server', families)).toBe('SE')
  })

  it('without the project list skips only the generic words', () => {
    expect(hqPlusTileOf('acme-agents')).toBe('AA')
    expect(hqPlusTileOf('mcp-server-api')).toBe('API')
  })

  it('counts a project under its slug and its repo name once', () => {
    expect([...hqPlusTileFamilies(['acme-agents', 'Acme Agents', 'other'])]).toEqual([])
  })
})
