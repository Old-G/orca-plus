import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hqRoomGroupsOf, removeHqRoom } from './hq-room-edit'

let hq: string

beforeEach(() => {
  hq = mkdtempSync(join(tmpdir(), 'hq-room-edit-'))
  mkdirSync(join(hq, 'workspaces', 'acme'), { recursive: true })
  writeFileSync(
    join(hq, 'workspaces', 'acme', 'workspace.yaml'),
    'name: Acme\ncolor: "#000000"\ngroup_id: g-acme\nprojects: []\n'
  )
})

afterEach(() => {
  rmSync(hq, { recursive: true, force: true })
})

function runtimeWith(
  groups: { id: string; parentGroupId: string | null }[],
  folders: { id: string; projectGroupId: string }[]
) {
  return {
    createProjectGroup: vi.fn(),
    updateProjectGroup: vi.fn(),
    deleteProjectGroup: vi.fn(async () => ({ deleted: true })),
    listProjectGroups: () => groups,
    listFolderWorkspaces: () => folders
  }
}

describe('removeHqRoom', () => {
  it('keeps a group that holds folder workspaces or nested groups, and the room with it', async () => {
    const runtime = runtimeWith(
      [
        { id: 'g-acme', parentGroupId: null },
        { id: 'g-acme-sub', parentGroupId: 'g-acme' }
      ],
      [{ id: 'f-notes', projectGroupId: 'g-acme-sub' }]
    )
    await expect(removeHqRoom(hqRoomGroupsOf(runtime), hq, 'acme', new Date())).rejects.toThrow(
      /1 folder workspace and 1 group/
    )
    expect(runtime.deleteProjectGroup).not.toHaveBeenCalled()
    expect(existsSync(join(hq, 'workspaces', 'acme', 'workspace.yaml'))).toBe(true)
  })

  it('removes a group that holds only projects', async () => {
    const runtime = runtimeWith(
      [
        { id: 'g-acme', parentGroupId: null },
        { id: 'g-kite', parentGroupId: null }
      ],
      [{ id: 'f-kite', projectGroupId: 'g-kite' }]
    )
    await removeHqRoom(hqRoomGroupsOf(runtime), hq, 'acme', new Date())
    expect(runtime.deleteProjectGroup).toHaveBeenCalledWith('g-acme')
    expect(existsSync(join(hq, 'workspaces', 'acme'))).toBe(false)
  })
})
