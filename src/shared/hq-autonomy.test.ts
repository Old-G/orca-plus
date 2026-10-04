import { describe, expect, it } from 'vitest'
import { hqAutonomyFor, parseHqAutonomy } from './hq-autonomy'

describe('HQ autonomy levels', () => {
  it('reads the default and per-project levels, ignoring comments', () => {
    const config = parseHqAutonomy(
      [
        '# How far an agent may go',
        'default: 1',
        'projects:',
        '  flowbridge: 0   # n8n flows live on prod',
        '  "orca-custom": 2',
        '  # strata: 3'
      ].join('\n')
    )
    expect(config).toEqual({ defaultLevel: 1, projects: { flowbridge: 0, 'orca-custom': 2 } })
    expect(hqAutonomyFor(config, 'flowbridge')).toBe(0)
    expect(hqAutonomyFor(config, 'lh-api')).toBe(1)
  })

  it('falls back to 1 without a file and never grants a level it cannot read', () => {
    expect(parseHqAutonomy(null)).toEqual({ defaultLevel: 1, projects: {} })
    const config = parseHqAutonomy('default: 7\nprojects:\n  lh-pay: high\n  lh-api: 3')
    expect(config).toEqual({ defaultLevel: 1, projects: { 'lh-api': 3 } })
  })

  it('reads project entries only under projects:', () => {
    expect(parseHqAutonomy('other:\n  lh-api: 3\ndefault: 0').projects).toEqual({})
  })
})
