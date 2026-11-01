import { describe, expect, it, vi } from 'vitest'
import type { ClaudeHandoffOffer } from '../../shared/claude-handoff-file'
import {
  claudeHandoffSuccessorWorktreeId,
  closeClaudeHandedOffChat
} from './claude-handoff-successor'

const OLD_TAB = 'structured-agent-session-claude_old'
const NEW_TAB = 'structured-agent-session-claude_new'

function offer(over: Partial<ClaudeHandoffOffer> = {}): ClaudeHandoffOffer {
  return {
    id: 's1',
    worktreeId: 'r1::/w/acme/feature',
    worktreeTitle: 'acme / feature',
    sessionId: 's1',
    created: '2026-11-01T17:59:14+03:00',
    branch: 'feature',
    head: 'abc1234',
    pushed: 'yes',
    tabId: OLD_TAB,
    ...over
  }
}

describe('claude handoff successor', () => {
  it('opens beside the old chat when its handoff lies in another workspace of the project', () => {
    expect(claudeHandoffSuccessorWorktreeId(offer({ tabWorktreeId: 'r1::/w/acme' }))).toBe(
      'r1::/w/acme'
    )
    expect(claudeHandoffSuccessorWorktreeId(offer())).toBe('r1::/w/acme/feature')
  })

  it('closes the old chat through the runtime, else through the window', async () => {
    const closeInWindow = vi.fn(() => true)
    const runtime = vi.fn(async () => undefined)
    const deps = { closeInRuntime: runtime, closeInWindow, log: () => {} }
    expect(
      await closeClaudeHandedOffChat(deps, offer({ tabWorktreeId: 'r1::/w/acme' }), NEW_TAB)
    ).toBe('runtime')
    expect(runtime).toHaveBeenCalledWith('id:r1::/w/acme', OLD_TAB)
    expect(closeInWindow).not.toHaveBeenCalled()

    // 01.11: a tab in a workspace the window had not published since the restart.
    runtime.mockRejectedValueOnce(new Error('tab_not_found'))
    expect(await closeClaudeHandedOffChat(deps, offer(), NEW_TAB)).toBe('window')
    expect(closeInWindow).toHaveBeenCalledWith(OLD_TAB)
  })

  it('says so when neither can close it, and leaves a terminal or the new chat alone', async () => {
    const deps = {
      closeInRuntime: async () => {
        throw new Error('tab_not_found')
      },
      closeInWindow: () => false,
      log: vi.fn()
    }
    expect(await closeClaudeHandedOffChat(deps, offer(), NEW_TAB)).toBe('failed')
    expect(deps.log).toHaveBeenCalledWith('closing the handed-off chat failed: tab_not_found')
    expect(await closeClaudeHandedOffChat(deps, offer({ tabId: 'tab-1' }), NEW_TAB)).toBe(
      'not-a-chat'
    )
    expect(await closeClaudeHandedOffChat(deps, offer({ tabId: NEW_TAB }), NEW_TAB)).toBe(
      'not-a-chat'
    )
  })
})
