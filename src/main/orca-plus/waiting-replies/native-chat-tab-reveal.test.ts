import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  provideNativeChatTabReveal,
  revealNativeChatTabQuietly,
  showNativeChatTab,
  type NativeChatTabRevealDeps
} from './native-chat-tab-reveal'

function deps(shown: boolean): NativeChatTabRevealDeps & {
  reveal: ReturnType<typeof vi.fn>
  publish: ReturnType<typeof vi.fn>
} {
  return {
    tabShown: () => shown,
    reveal: vi.fn(async (sessionId: string) => ({
      sessionId,
      workspaceId: 'repo::/work',
      agent: 'claude'
    })),
    publish: vi.fn(async () => undefined)
  }
}

describe('revealNativeChatTabQuietly', () => {
  afterEach(() => provideNativeChatTabReveal(null))

  it('puts a closed chat that took a message back in the sidebar without focusing it', async () => {
    const d = deps(false)
    await expect(revealNativeChatTabQuietly(d, 'claude_1')).resolves.toBe('shown')
    expect(d.publish).toHaveBeenCalledWith({
      sessionId: 'claude_1',
      workspaceId: 'repo::/work',
      agent: 'claude',
      activate: false
    })
  })

  it('leaves a chat whose tab is open alone', async () => {
    const d = deps(true)
    await expect(revealNativeChatTabQuietly(d, 'claude_1')).resolves.toBe('listed')
    expect(d.reveal).not.toHaveBeenCalled()
    expect(d.publish).not.toHaveBeenCalled()
  })

  it('never throws once the message is delivered, even when the chat is gone', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const d = deps(false)
    d.reveal.mockRejectedValueOnce(new Error('agent_session_identity_required'))
    provideNativeChatTabReveal(d)
    await expect(showNativeChatTab('claude_1')).resolves.toBeUndefined()
    expect(d.publish).not.toHaveBeenCalled()
    warn.mockRestore()
  })
})
