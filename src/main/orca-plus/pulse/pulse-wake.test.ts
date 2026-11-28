import { describe, expect, it } from 'vitest'
import { pulseWakeUnknown, resolvePulseWakeChat } from './pulse-wake'

const lookup = {
  isChat: (id: string) => id === 'chat-1' || id === 'chat-old',
  byAddress: (address: string) => (address === 'acme/orders' ? [{ sessionId: 'chat-old' }] : []),
  liveOf: (id: string) => (id === 'chat-old' ? 'chat-new' : id)
}

describe('resolvePulseWakeChat', () => {
  it('takes a session id as it is, and follows a handed-off chat to its live end', () => {
    expect(resolvePulseWakeChat('chat-1', lookup)).toBe('chat-1')
    expect(resolvePulseWakeChat(' chat-old ', lookup)).toBe('chat-new')
  })

  it('takes a thread address to its newest chat, followed to the live end', () => {
    expect(resolvePulseWakeChat('acme/orders', lookup)).toBe('chat-new')
  })

  it('returns null for an unknown chat or an empty value, with a message that names it', () => {
    expect(resolvePulseWakeChat('acme/none', lookup)).toBeNull()
    expect(resolvePulseWakeChat('  ', lookup)).toBeNull()
    expect(pulseWakeUnknown('acme/none')).toContain('acme/none')
  })
})
