// Custom build (hq-group-chat): a manual Project Group's own workspace (the HQ group chat) is shown,
// though the group has no parent folder.
import { describe, expect, it } from 'vitest'
import type { FolderWorkspace } from '../folder-workspaces/folder-workspace-types'
import type { ProjectGroup } from '../project-group-types'
import { getRenderableFolderWorkspaces } from './folder-workspace-lanes'

const manualGroup = {
  id: 'group-manual',
  name: 'Manual',
  parentPath: null,
  parentGroupId: null,
  createdFrom: 'manual',
  tabOrder: 0,
  isCollapsed: false,
  color: null,
  createdAt: 0,
  updatedAt: 0
} satisfies ProjectGroup

function workspace(projectGroupId: string): FolderWorkspace {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the lane resolver reads only the group id and host fields.
  return {
    id: `folder-${projectGroupId}`,
    projectGroupId,
    name: 'Group chat',
    folderPath: '/hq/groups/manual',
    linkedTask: null,
    comment: '',
    isArchived: false,
    isUnread: false
  } as FolderWorkspace
}

describe('getRenderableFolderWorkspaces (custom build)', () => {
  it('keeps the workspace of a group without a parent folder', () => {
    const rendered = getRenderableFolderWorkspaces([workspace(manualGroup.id)], [manualGroup])
    expect(rendered).toHaveLength(1)
    expect(rendered[0]?.projectGroup.id).toBe('group-manual')
  })

  it('still hides the workspace of a group that is not there', () => {
    expect(getRenderableFolderWorkspaces([workspace('missing')], [manualGroup])).toEqual([])
  })
})
