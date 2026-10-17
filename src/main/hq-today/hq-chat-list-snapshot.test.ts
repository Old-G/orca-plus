import { describe, expect, it } from 'vitest'
import { publishHqChatList, readHqChatList } from './hq-chat-list-snapshot'

const row = {
  key: 'k1',
  group: 'needs',
  worktreeId: 'w1',
  paneKey: 'tab:leaf',
  executionHostId: 'local',
  projectName: 'orca-custom',
  worktreeName: 'custom',
  title: 'Лента',
  preview: 'Which tenant?',
  agentType: 'claude',
  unseen: true,
  sortAt: 5,
  color: '#f97316'
}

describe('HQ chat list snapshot', () => {
  it('keeps the rows that parse and dates the publish', () => {
    expect(publishHqChatList([row, { ...row, key: 'k2', group: 'nope' }, 'junk'], 1_000)).toBe(1)
    expect(readHqChatList()).toEqual({ items: [row], publishedAt: 1_000 })
    expect(publishHqChatList('not a list', 2_000)).toBe(0)
    expect(readHqChatList()).toEqual({ items: [], publishedAt: 2_000 })
  })
})
