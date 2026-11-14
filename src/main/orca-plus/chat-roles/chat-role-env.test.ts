import { afterEach, describe, expect, it } from 'vitest'
import { bindChatRoleLookup, chatRoleChildEnv } from './chat-role-env'

afterEach(() => bindChatRoleLookup(null))

describe('ORCA_CHAT_ROLE in a native chat process (hq-chat-roles)', () => {
  it('gives the chat its kept role and nothing to a chat without one', () => {
    bindChatRoleLookup((sessionId) => (sessionId === 'w1' ? 'worker' : null))
    expect(chatRoleChildEnv('w1')).toEqual({ ORCA_CHAT_ROLE: 'worker' })
    expect(chatRoleChildEnv('other')).toEqual({})
  })

  it('starts the chat without a role when the store cannot be read', () => {
    expect(chatRoleChildEnv('w1')).toEqual({})
    bindChatRoleLookup(() => {
      throw new Error('pulse closed')
    })
    expect(chatRoleChildEnv('w1')).toEqual({})
  })
})
