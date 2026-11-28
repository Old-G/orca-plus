import { describe, expect, it } from 'vitest'
import type { HqLiveSession, HqSessionsResult } from '../shared/hq-sessions'
import { formatHqSessions } from './hq-format'
import { filterHqSessions, filterHqSessionsResult, hasHqSessionsFilter } from './hq-sessions-filter'

function chat(over: Partial<HqLiveSession>): HqLiveSession {
  return {
    sessionId: 'claude_1',
    address: 'orca/w-a',
    project: 'orca',
    workspace: 'ws',
    worktreeId: 'wt',
    name: 'Orca lead of wave 2',
    state: 'done',
    midTurn: false,
    lastActivityAt: Date.now() - 5 * 60_000,
    contextPct: 12.4,
    ownerAt: null,
    onScreen: false,
    tabOpen: true,
    role: null,
    ...over
  }
}

function result(sessions: HqLiveSession[]): HqSessionsResult {
  return { mode: 'report', dryRun: false, sessions, queued: 0, unreviewed: 0, actions: [] }
}

const ALL = [
  chat({ sessionId: 's1', address: 'orca/lead-a', name: 'Orca lead of wave 2', role: 'lead' }),
  chat({
    sessionId: 's2',
    address: 'acme-api/w-cap',
    project: 'acme-api',
    name: 'Refund cap',
    state: 'working',
    midTurn: true
  }),
  chat({
    sessionId: 's3',
    address: 'orca/w-old',
    name: 'Old worker',
    state: 'closed',
    tabOpen: false
  })
]

describe('filterHqSessions', () => {
  it('keeps everything with no filter', () => {
    expect(filterHqSessions(ALL, {})).toHaveLength(3)
    expect(hasHqSessionsFilter({})).toBe(false)
  })

  it('filters by state list, role, project, address and name', () => {
    expect(filterHqSessions(ALL, { state: 'working,closed' }).map((s) => s.sessionId)).toEqual([
      's2',
      's3'
    ])
    expect(filterHqSessions(ALL, { role: 'lead' }).map((s) => s.sessionId)).toEqual(['s1'])
    expect(filterHqSessions(ALL, { project: 'ACME' }).map((s) => s.sessionId)).toEqual(['s2'])
    expect(filterHqSessions(ALL, { address: 'w-old' }).map((s) => s.sessionId)).toEqual(['s3'])
    expect(filterHqSessions(ALL, { name: 'refund' }).map((s) => s.sessionId)).toEqual(['s2'])
  })

  it('--find needs every word, across name, address, project and session id, closed chats included', () => {
    expect(filterHqSessions(ALL, { find: 'orca lead' }).map((s) => s.sessionId)).toEqual(['s1'])
    expect(filterHqSessions(ALL, { find: 'old worker' }).map((s) => s.sessionId)).toEqual(['s3'])
    expect(filterHqSessions(ALL, { find: 's2' }).map((s) => s.sessionId)).toEqual(['s2'])
    expect(filterHqSessions(ALL, { find: 'orca nothing' })).toEqual([])
  })

  it('--limit cuts the tail', () => {
    expect(filterHqSessions(ALL, { limit: 2 }).map((s) => s.sessionId)).toEqual(['s1', 's2'])
  })

  it('keeps the result shape; only sessions change', () => {
    const out = filterHqSessionsResult(result(ALL), { role: 'lead' })
    expect(Object.keys(out)).toEqual(Object.keys(result(ALL)))
    expect(out.sessions).toHaveLength(1)
  })
})

describe('formatHqSessions', () => {
  it('plain call hides closed chats and points at how to find them', () => {
    const text = formatHqSessions(result(ALL))
    expect(text).toContain('orca/lead-a')
    expect(text).not.toContain('orca/w-old')
    expect(text).toContain('--state closed')
  })

  it('plain call lists 20 chats at most and says how many are left', () => {
    const many = Array.from({ length: 30 }, (_, i) => chat({ sessionId: `m${i}` }))
    const text = formatHqSessions(result(many))
    expect(
      text.split('\n').filter((line) => line.includes('claude') || /m\d+$/.test(line))
    ).toHaveLength(20)
    expect(text).toContain('… and 10 more')
  })

  it('filtered call shows closed chats, marked as in History', () => {
    const text = formatHqSessions(result([ALL[2]]), { filtered: true })
    expect(text).toContain('orca/w-old')
    expect(text).toContain('(History)')
    expect(formatHqSessions(result([]), { filtered: true })).toContain('No chat matches.')
  })

  it('a line is short: no «active … ago» prose', () => {
    const line = formatHqSessions(result([ALL[0]])).split('\n')[1]
    expect(line).toMatch(
      /^done\s+orca\/lead-a {2}«Orca lead of wave 2» {2}· orca {2}ctx 12% {2}5m {2}s1$/
    )
  })

  it('state and role match without regard to case', () => {
    expect(filterHqSessions(ALL, { state: 'Closed' }).map((s) => s.sessionId)).toEqual(['s3'])
    expect(filterHqSessions(ALL, { role: 'LEAD' }).map((s) => s.sessionId)).toEqual(['s1'])
  })
})
