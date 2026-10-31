import { describe, expect, it } from 'vitest'
import { createHqChatProjects, hqProjectOfChat } from './hq-chat-project'
import type { HqRoomSources } from './hq-journal-rooms'

const sources: HqRoomSources = {
  spaces: [],
  groupRooms: new Map(),
  projectOfRepo: new Map([['r-app', 'acme-app']]),
  defaultRoom: null,
  repos: [
    { id: 'r-app', path: '/Users/me/Projects/app', displayName: 'App' },
    { id: 'r-tools', path: '/Users/me/Projects/tools', displayName: 'Tools' }
  ],
  hqPath: '/Users/me/HQ',
  folderGroup: () => null,
  sessionWorkspace: (id) =>
    ({
      chat_app: 'r-app::/Users/me/wt/app-feature',
      chat_tools: 'r-tools::/Users/me/Projects/tools',
      chat_folder: 'folder:f1'
    })[id] ?? null
}

describe('hqProjectOfChat', () => {
  it('names the HQ project of the chat’s workspace, its worktree or its folder', () => {
    expect(hqProjectOfChat(sources, { sessionId: 'chat_app' })).toBe('acme-app')
    expect(hqProjectOfChat(sources, { worktreeId: 'r-app::/Users/me/wt/other' })).toBe('acme-app')
    expect(hqProjectOfChat(sources, { cwd: '/Users/me/Projects/app/src' })).toBe('acme-app')
  })

  it('leaves a repo or folder HQ does not know without a project', () => {
    expect(
      hqProjectOfChat(sources, { sessionId: 'chat_tools', cwd: '/Users/me/Projects/tools' })
    ).toBeNull()
    expect(hqProjectOfChat(sources, { sessionId: 'chat_folder' })).toBeNull()
    expect(hqProjectOfChat(sources, { cwd: '/Users/me/elsewhere/app' })).toBeNull()
    expect(hqProjectOfChat(sources, {})).toBeNull()
  })
})

describe('createHqChatProjects', () => {
  it('answers from the last read until the rooms are read again', async () => {
    let calls = 0
    const projects = createHqChatProjects(async () => {
      calls += 1
      return calls === 1 ? sources : null
    })
    expect(projects.now({ sessionId: 'chat_app' })).toBeNull()
    expect(await projects.read({ sessionId: 'chat_app' })).toBe('acme-app')
    expect(projects.now({ sessionId: 'chat_app' })).toBe('acme-app')
    expect(await projects.read({ sessionId: 'chat_app' })).toBe('acme-app')
  })
})
