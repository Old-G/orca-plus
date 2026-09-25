import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { once: vi.fn() } }))

import { resolveSlackRepo, slugForSlackTask } from './slack-socket-service'

const repos = [
  { id: 'r1', displayName: 'orca', path: '/p/orca' },
  { id: 'r2', displayName: 'fixture', path: '/a/fixture' },
  { id: 'r3', displayName: 'fixture', path: '/b/fixture' }
]

describe('resolveSlackRepo', () => {
  it('picks a unique name case-insensitively and passes explicit selectors through', () => {
    expect(resolveSlackRepo('Orca', repos)).toBe('id:r1')
    expect(resolveSlackRepo('id:r3', repos)).toBe('id:r3')
  })

  it('names the choices when a name is ambiguous or unknown', () => {
    expect(() => resolveSlackRepo('fixture', repos)).toThrow(/`id:r2` \(\/a\/fixture\), `id:r3`/)
    expect(() => resolveSlackRepo('nope', repos)).toThrow(/Known repos: `orca`, `fixture`/)
  })
})

describe('slugForSlackTask', () => {
  it('builds a short branch-safe name', () => {
    expect(slugForSlackTask('Fix the Login bug, please! now and later')).toBe(
      'slack-fix-the-login-bug-please'
    )
    expect(slugForSlackTask('!!!')).toBe('slack-task')
  })
})
