import { afterEach, describe, expect, it, vi } from 'vitest'
import { linkLaunchedChat } from './hq-chat-link'

const chat = { outcome: { kind: 'structured', sessionId: 'claude_kid', handle: 'h' } } as const
const terminal = { outcome: { kind: 'terminal', handle: 'h' } } as const

afterEach(() => vi.unstubAllEnvs())

describe('linkLaunchedChat', () => {
  it('names the calling chat as the parent of the chat it started', async () => {
    vi.stubEnv('ORCA_AGENT_SESSION_ID', 'claude_parent')
    const call = vi.fn().mockResolvedValue({ result: { linked: true } })
    await linkLaunchedChat({ call, isRemote: false }, chat)
    expect(call).toHaveBeenCalledWith('hq.linkChat', {
      callerSessionId: 'claude_parent',
      sessionId: 'claude_kid'
    })
  })

  it('links nothing outside a chat, for a terminal agent, or remotely, and never throws', async () => {
    const call = vi.fn().mockRejectedValue(new Error('unknown method'))
    vi.stubEnv('ORCA_AGENT_SESSION_ID', '')
    await linkLaunchedChat({ call, isRemote: false }, chat)
    vi.stubEnv('ORCA_AGENT_SESSION_ID', 'claude_parent')
    await linkLaunchedChat({ call, isRemote: false }, terminal)
    await linkLaunchedChat({ call, isRemote: true }, chat)
    expect(call).not.toHaveBeenCalled()
    await expect(linkLaunchedChat({ call, isRemote: false }, chat)).resolves.toBeUndefined()
  })
})
