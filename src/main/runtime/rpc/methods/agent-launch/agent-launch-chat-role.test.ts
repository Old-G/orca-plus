import { describe, expect, it, vi } from 'vitest'
import type { HqChatRole } from '../../../../../shared/hq-chat-role'
import { HQ_CHAT_ROLE_SESSION_OPTION } from '../../../../../shared/hq-chat-role'
import { createKeepingChatRole } from './agent-launch-chat-role'

function store(initial: Record<string, HqChatRole> = {}) {
  const roles = new Map(Object.entries(initial))
  return {
    roles,
    setRole: vi.fn((input: { sessionId: string; role: HqChatRole; at: number }) => {
      roles.set(input.sessionId, input.role)
    }),
    roleOf: (sessionId: string) => roles.get(sessionId) ?? null,
    clearRole: vi.fn((sessionId: string) => {
      roles.delete(sessionId)
    })
  }
}

const asLead = { [HQ_CHAT_ROLE_SESSION_OPTION]: 'lead' }

describe('createKeepingChatRole (hq-chat-roles, Codex 15.11)', () => {
  it('keeps the role before the process starts', async () => {
    const pulse = store()
    const seen: (string | null)[] = []
    await createKeepingChatRole(
      () => pulse,
      's-new',
      asLead,
      async () => {
        seen.push(pulse.roleOf('s-new'))
        return { ok: true as const }
      }
    )
    expect(seen).toEqual(['lead'])
    expect(pulse.roles.get('s-new')).toBe('lead')
  })

  it('leaves an existing chat’s role as it was when its id was refused', async () => {
    const pulse = store({ 's-taken': 'worker' })
    const result = await createKeepingChatRole(
      () => pulse,
      's-taken',
      asLead,
      async () => ({
        ok: false as const
      })
    )
    expect(result.ok).toBe(false)
    expect(pulse.roles.get('s-taken')).toBe('worker')
  })

  it('writes no role for a chat without one when its launch is refused or throws', async () => {
    const pulse = store()
    await createKeepingChatRole(
      () => pulse,
      's-taken',
      asLead,
      async () => ({ ok: false as const })
    )
    expect(pulse.roles.has('s-taken')).toBe(false)
    await expect(
      createKeepingChatRole(
        () => pulse,
        's-other',
        asLead,
        async () => {
          throw new Error('host down')
        }
      )
    ).rejects.toThrow('host down')
    expect(pulse.roles.has('s-other')).toBe(false)
  })

  it('never fails the launch over a pulse store that cannot be written', async () => {
    const result = await createKeepingChatRole(
      () => {
        throw new Error('no pulse db')
      },
      's-new',
      asLead,
      async () => ({ ok: true as const })
    )
    expect(result.ok).toBe(true)
  })
})
