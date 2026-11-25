// Custom build (hq-stable-chat-order, owner 25.11): the phone's open chats keep their order.
import { describe, expect, it } from 'vitest'
import { hqChatWireByProject, type HqChatWireItem } from './hq-chat-wire'

function chat(key: string, extra: Partial<HqChatWireItem>): HqChatWireItem {
  return {
    key,
    group: 'done',
    worktreeId: 'wt1',
    paneKey: `${key}:leaf`,
    executionHostId: null,
    projectName: 'acme-app',
    worktreeName: 'main',
    title: key,
    preview: '',
    agentType: 'claude',
    unseen: false,
    sortAt: 1,
    color: null,
    ...extra
  }
}

const keys = (items: readonly HqChatWireItem[]): string[][] =>
  hqChatWireByProject(items).map(({ items: list }) => list.map((item) => item.key))

describe('hqChatWireByProject', () => {
  it('lists the newest chat first, and its project first', () => {
    const items = [
      chat('old', { placedAt: 1 }),
      chat('other', { placedAt: 2, projectName: 'acme-site' }),
      chat('new', { placedAt: 3 })
    ]
    expect(keys(items)).toEqual([['new', 'old'], ['other']])
  })

  it('keeps split-pane agents of one terminal in place whichever asks', () => {
    const left = chat('tab-1:left', { placedAt: 5 })
    const right = chat('tab-1:right', { placedAt: 5 })
    const asking = { ...right, group: 'needs' as const }
    expect(keys([left, right])).toEqual([['tab-1:left', 'tab-1:right']])
    // Why reversed input: the Mac sends a chat that asks before the others.
    expect(keys([asking, left])).toEqual([['tab-1:left', 'tab-1:right']])
  })

  it('keeps the order an older Mac sends without placedAt', () => {
    expect(keys([chat('b', {}), chat('a', {})])).toEqual([['b', 'a']])
  })
})
