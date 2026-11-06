import { describe, expect, it } from 'vitest'
import { hqAutonomyFor, parseHqAutonomy, parseHqRemoteNoApprove } from './hq-autonomy'

describe('HQ autonomy levels', () => {
  it('reads the default and per-project levels, ignoring comments', () => {
    const config = parseHqAutonomy(
      [
        '# How far an agent may go',
        'default: 1',
        'projects:',
        '  billing: 0   # n8n flows live on prod',
        '  "orca-custom": 2',
        '  # strata: 3'
      ].join('\n')
    )
    expect(config).toEqual({ defaultLevel: 1, projects: { billing: 0, 'orca-custom': 2 } })
    expect(hqAutonomyFor(config, 'billing')).toBe(0)
    expect(hqAutonomyFor(config, 'acme-api')).toBe(1)
  })

  it('falls back to 1 without a file and never grants a level it cannot read', () => {
    expect(parseHqAutonomy(null)).toEqual({ defaultLevel: 1, projects: {} })
    const config = parseHqAutonomy('default: 7\nprojects:\n  acme-pay: high\n  acme-api: 3')
    expect(config).toEqual({ defaultLevel: 1, projects: { 'acme-api': 3 } })
  })

  it('reads project entries only under projects:', () => {
    expect(parseHqAutonomy('other:\n  acme-api: 3\ndefault: 0').projects).toEqual({})
  })
})

describe('HQ remote_no_approve', () => {
  it('reads hosts, containers, rm paths and mktemp from comma lists', () => {
    const text = [
      'default: 1',
      'projects:',
      '  acme-api: 3',
      'remote_no_approve:',
      '  hosts: myserver   # the deploy box',
      '  containers: [api-check, "*-shadow"]',
      '  rm_paths: ~/shadow_*, /tmp/*',
      '  mktemp: yes',
      '  container_rm_paths: agent-app:/app/e2e_*.py, agent-app:/app/deep_probe.py',
      'other: 1'
    ].join('\n')
    expect(parseHqRemoteNoApprove(text)).toEqual({
      hosts: ['myserver'],
      containers: ['api-check', '*-shadow'],
      rmPaths: ['~/shadow_*', '/tmp/*'],
      containerRmPaths: ['agent-app:/app/e2e_*.py', 'agent-app:/app/deep_probe.py'],
      mktemp: true
    })
    expect(parseHqAutonomy(text).projects).toEqual({ 'acme-api': 3 })
  })

  it('passes nothing without the block or when it is commented out', () => {
    const none = { hosts: [], containers: [], rmPaths: [], containerRmPaths: [], mktemp: false }
    expect(parseHqRemoteNoApprove(null)).toEqual(none)
    expect(parseHqRemoteNoApprove('remote_no_approve:\n  # hosts: myserver')).toEqual(none)
    expect(parseHqRemoteNoApprove('projects:\n  hosts: myserver')).toEqual(none)
  })
})
