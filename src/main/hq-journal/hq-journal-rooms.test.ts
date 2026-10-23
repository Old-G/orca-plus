import { describe, expect, it } from 'vitest'
import type { HqSpace } from '../../shared/hq-spaces'
import { hqCallerScope, hqPlaceOf, type HqRoomSources } from './hq-journal-rooms'

const space = (slug: string, extra: Partial<HqSpace>): HqSpace => ({
  slug,
  name: slug,
  color: '#000000',
  repoIds: [],
  projects: [],
  messenger: null,
  tasks: null,
  ...extra
})

const sources: HqRoomSources = {
  spaces: [
    space('acme', {
      repoIds: ['r-api'],
      projects: ['acme-api'],
      messenger: 'slack',
      tasks: 'clickup'
    }),
    space('hobby', { repoIds: ['r-kite'], projects: ['kite'] })
  ],
  groupRooms: new Map([['Acme Projects', 'acme']]),
  projectOfRepo: new Map([
    ['r-api', 'acme-api'],
    ['r-kite', 'kite'],
    ['r-notes', 'notes']
  ]),
  defaultRoom: 'hobby',
  repos: [
    { id: 'r-api', path: '/Users/me/Projects/acme-api', displayName: 'Acme API' },
    { id: 'r-kite', path: '/Users/me/Projects/kite', displayName: 'Kite' },
    { id: 'r-hq', path: '/Users/me/HQ', displayName: 'HQ' }
  ],
  hqPath: '/Users/me/HQ',
  folderGroup: (id) => (id === 'f1' ? 'Acme Projects' : null),
  sessionWorkspace: (id) =>
    ({
      claude_kite: 'r-kite::/Users/me/Projects/kite',
      claude_hq: 'r-hq::/Users/me/HQ',
      claude_group: 'folder:f1'
    })[id] ?? null
}

describe('hqPlaceOf', () => {
  it('places by workspace, folder group, project name and channel, in that order', () => {
    expect(hqPlaceOf(sources, { worktreeId: 'r-api::/Users/me/wt/feature' })).toEqual({
      room: 'acme',
      project: 'acme-api',
      hq: false,
      firm: true
    })
    expect(hqPlaceOf(sources, { sessionId: 'claude_group' }).room).toBe('acme')
    expect(hqPlaceOf(sources, { project: 'Kite' })).toMatchObject({
      room: 'hobby',
      project: 'kite'
    })
    expect(hqPlaceOf(sources, { channel: 'slack' })).toMatchObject({ room: 'acme', firm: false })
    expect(hqPlaceOf(sources, { cwd: '/Users/me/HQ/plans' }).hq).toBe(true)
  })

  it('puts an HQ project no room claims in the default room, and anything unknown nowhere', () => {
    expect(hqPlaceOf(sources, { worktreeId: 'r-notes::/Users/me/Projects/notes' }).room).toBe(
      'hobby'
    )
    expect(hqPlaceOf(sources, { project: 'Notes' })).toMatchObject({ room: 'hobby', firm: false })
    expect(hqPlaceOf(sources, { project: 'elsewhere' }).room).toBe('_unassigned')
  })
})

describe('hqCallerScope', () => {
  it("keeps a chat to its own room even when it runs from HQ's folder", () => {
    expect(hqCallerScope(sources, { sessionId: 'claude_kite', cwd: '/Users/me/HQ' })).toMatchObject(
      { kind: 'room', room: 'hobby', project: 'kite' }
    )
  })

  it('gives a chat in the HQ repo the overview, and a stranger the unassigned room', () => {
    expect(hqCallerScope(sources, { sessionId: 'claude_hq' }).kind).toBe('overview')
    expect(hqCallerScope(sources, { cwd: '/tmp' })).toMatchObject({
      kind: 'room',
      room: '_unassigned'
    })
  })
})
