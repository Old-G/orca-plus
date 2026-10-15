import { beforeEach, describe, expect, it, vi } from 'vitest'

type StoreView = { activeView: string; settings: { hqChatsView?: boolean } | null }

const mocks = vi.hoisted(() => {
  const state: StoreView = { activeView: 'hq', settings: {} }
  return { state, openHqScreen: vi.fn() }
})

vi.mock('@/store', () => ({ useAppStore: { getState: () => mocks.state } }))
vi.mock('./hq-view', () => ({ openHqScreen: mocks.openHqScreen }))

import { hqChatKey } from './hq-chat-list'
import { openChatInShownHq, rememberHqChat, rememberedHqChat } from './hq-chat-open'

beforeEach(() => {
  vi.clearAllMocks()
  rememberHqChat(null)
  mocks.state = { activeView: 'hq', settings: {} }
})

describe('openChatInShownHq', () => {
  it('opens the chat in HQ while its messenger is in front', () => {
    expect(openChatInShownHq('wt-1', 'tab-1')).toBe(true)
    expect(rememberedHqChat()).toBe(hqChatKey('wt-1', 'tab-1'))
    expect(mocks.openHqScreen).toHaveBeenCalledWith('chats')
  })

  it('leaves the chat to its project in the Code mode, the old HQ view, or without a tab', () => {
    mocks.state = { activeView: 'terminal', settings: {} }
    expect(openChatInShownHq('wt-1', 'tab-1')).toBe(false)
    mocks.state = { activeView: 'hq', settings: { hqChatsView: false } }
    expect(openChatInShownHq('wt-1', 'tab-1')).toBe(false)
    mocks.state = { activeView: 'hq', settings: {} }
    expect(openChatInShownHq('wt-1', undefined)).toBe(false)
    expect(mocks.openHqScreen).not.toHaveBeenCalled()
    expect(rememberedHqChat()).toBeNull()
  })
})
