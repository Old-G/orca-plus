import { afterEach, describe, expect, it, vi } from 'vitest'
import { REPO_HANDLERS } from './repo'
import type { HandlerContext } from '../dispatch'
import type { RuntimeClient } from '../runtime-client'

// Made-up fixture groups, not real Orca data.
const groups = [
  {
    id: 'group-folder',
    name: 'Fixture Folder Group',
    parentPath: '/tmp/fixture-projects',
    parentGroupId: null,
    createdFrom: 'folder-scan',
    tabOrder: 0,
    isCollapsed: false,
    color: null,
    createdAt: 1,
    updatedAt: 1
  },
  {
    id: 'group-manual',
    name: 'Fixture Manual Group',
    parentPath: null,
    parentGroupId: null,
    createdFrom: 'manual',
    tabOrder: 1,
    isCollapsed: false,
    color: null,
    createdAt: 1,
    updatedAt: 1
  }
]

function runGroups(json: boolean, response: unknown): { call: ReturnType<typeof vi.fn> } {
  const call = vi.fn().mockResolvedValue(response)
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the handler only uses client.call.
  const client = { call } as unknown as RuntimeClient
  const ctx: HandlerContext = { flags: new Map(), client, cwd: '/tmp', json, rawArgs: [] }
  void REPO_HANDLERS['repo groups'](ctx)
  return { call }
}

describe('orca repo groups', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('reads the groups through the read-only projectGroup.list RPC', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const { call } = runGroups(true, { id: 'r1', ok: true, result: { groups } })
    await vi.waitFor(() => expect(call).toHaveBeenCalledTimes(1))
    expect(call).toHaveBeenCalledWith('projectGroup.list')
  })

  it('prints the full envelope as JSON', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    runGroups(true, { id: 'r1', ok: true, result: { groups } })
    await vi.waitFor(() => expect(log).toHaveBeenCalled())
    expect(JSON.parse(String(log.mock.calls[0][0])).result.groups).toEqual(groups)
  })

  it('prints one line per group with its folder when it has one', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    runGroups(false, { id: 'r1', ok: true, result: { groups } })
    await vi.waitFor(() => expect(log).toHaveBeenCalled())
    expect(String(log.mock.calls[0][0])).toBe(
      'group-folder  Fixture Folder Group  /tmp/fixture-projects\ngroup-manual  Fixture Manual Group'
    )
  })

  it('says so when there are no groups', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    runGroups(false, { id: 'r1', ok: true, result: { groups: [] } })
    await vi.waitFor(() => expect(log).toHaveBeenCalled())
    expect(String(log.mock.calls[0][0])).toBe('No project groups found.')
  })
})
