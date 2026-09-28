import { describe, expect, it } from 'vitest'
import type { FolderWorkspace } from './folder-workspace-types'
import { findHqGroupChatWorkspace, readHqGroupChatPath } from './hq-group-chat'

function workspace(fields: Partial<FolderWorkspace>): FolderWorkspace {
  return {
    id: 'w-1',
    projectGroupId: 'g-1',
    name: 'Group chat',
    folderPath: '/hq/chats/team-a',
    linkedTask: null,
    comment: '',
    isArchived: false,
    isUnread: false,
    isPinned: false,
    sortOrder: 1,
    lastActivityAt: 2,
    createdAt: 3,
    updatedAt: 4,
    ...fields
  }
}

describe('readHqGroupChatPath', () => {
  it('reads the path from the last line of the report', () => {
    expect(readHqGroupChatPath('noise\n{"path":"/hq/chats/team-a","changed":false}\n')).toBe(
      '/hq/chats/team-a'
    )
  })

  it('returns null for empty, malformed or path-less output', () => {
    expect(readHqGroupChatPath('')).toBeNull()
    expect(readHqGroupChatPath('{oops')).toBeNull()
    expect(readHqGroupChatPath('{"path":""}')).toBeNull()
    expect(readHqGroupChatPath('null')).toBeNull()
  })
})

describe('findHqGroupChatWorkspace', () => {
  it('finds the live chat workspace of the group on that folder', () => {
    const chat = workspace({ id: 'chat' })
    const list = [
      workspace({ id: 'other-group', projectGroupId: 'g-2' }),
      workspace({ id: 'other-folder', folderPath: '/elsewhere' }),
      workspace({ id: 'archived', isArchived: true }),
      chat
    ]
    expect(findHqGroupChatWorkspace(list, 'g-1', '/hq/chats/team-a')).toBe(chat)
  })

  it('returns null when the group has no chat yet', () => {
    expect(
      findHqGroupChatWorkspace([workspace({ isArchived: true })], 'g-1', '/hq/chats/team-a')
    ).toBeNull()
  })
})
