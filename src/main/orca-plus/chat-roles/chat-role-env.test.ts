import { afterEach, describe, expect, it } from 'vitest'
import { bindChatRoleLookup, bindChatRoleLookupToRuntime, chatRoleChildEnv } from './chat-role-env'

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

describe('the role lookup of a host (hq-chat-roles, Codex 18.11)', () => {
  it('reads the role from the runtime it is bound to, on a headless host too', () => {
    const roles: Record<string, 'lead' | 'worker'> = { l1: 'lead' }
    bindChatRoleLookupToRuntime({ pulseChats: () => ({ roleOf: (id) => roles[id] ?? null }) })
    expect(chatRoleChildEnv('l1')).toEqual({ ORCA_CHAT_ROLE: 'lead' })
    expect(chatRoleChildEnv('w9')).toEqual({})
  })
})
