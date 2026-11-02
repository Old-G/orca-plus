import { describe, expect, it } from 'vitest'
import type { HqChatItem } from '../hq/hq-chat-list'
import { hqPlusTerminalDraftChat } from './use-hq-plus-drafts'

const terminal = (paneKey: string): HqChatItem =>
  ({ key: paneKey, kind: 'terminal', card: { tabId: 'tab-1', paneKey } }) as unknown as HqChatItem

// Codex 02.11 (draft-matched-to-tab): split panes share a tab, and each pane is its own agent's chat.
describe('the chat a terminal draft belongs to', () => {
  it('is the chat of the very pane typed in, not the first agent in its tab', () => {
    const items = [terminal('tab-1:leaf-1'), terminal('tab-1:leaf-2')]
    expect(hqPlusTerminalDraftChat(items, 'tab-1:leaf-2')?.key).toBe('tab-1:leaf-2')
  })

  it('falls back to the chat holding the terminal tab', () => {
    const chat = {
      key: 'wt\u0000orca-tab',
      kind: 'chat',
      tab: { id: 'orca-tab', entityId: 'tab-9' }
    }
    const items = [chat as unknown as HqChatItem]
    expect(hqPlusTerminalDraftChat(items, 'tab-9:leaf-1')?.key).toBe('wt\u0000orca-tab')
  })
})
