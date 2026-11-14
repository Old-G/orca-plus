import { describe, expect, it } from 'vitest'
import {
  hqChatRoleLabel,
  hqChatRoleTask,
  hqStripRoleLabel,
  hqUniqueAddress,
  isHqChatRole
} from './hq-chat-role'
import { hqChatAddress } from './hq-journal'

describe('chat roles (hq-chat-roles)', () => {
  it('knows the four roles and their labels', () => {
    expect(['lead', 'sublead', 'worker', 'review'].every(isHqChatRole)).toBe(true)
    expect(isHqChatRole('boss')).toBe(false)
    expect(
      ['lead', 'sublead', 'worker', 'review'].map((role) => hqChatRoleLabel(role as never))
    ).toEqual(['LEAD', 'SUB-LEAD', 'W', 'REVIEW'])
  })

  it('strips a leading label only when it is one', () => {
    expect(hqStripRoleLabel('W · Fix the build')).toBe('Fix the build')
    expect(hqStripRoleLabel('Sub-lead: Payments')).toBe('Payments')
    expect(hqStripRoleLabel('Write the tests')).toBe('Write the tests')
  })

  it('takes a role chat task up to its first sentence end', () => {
    expect(hqChatRoleTask('worker', 'W · Fix v1.2 build. Then more')).toBe('w Fix v1.2 build')
    expect(hqChatRoleTask('review', 'One line\nsecond')).toBe('review One line')
  })

  it('adds a number to a taken address', () => {
    const taken = new Set(['acme/x', 'acme/x-2'])
    expect(hqUniqueAddress('acme/y', (a) => taken.has(a))).toBe('acme/y')
    expect(hqUniqueAddress('acme/x', (a) => taken.has(a))).toBe('acme/x-3')
  })

  it('keeps the old address of a chat with no role and no clash', () => {
    expect(hqChatAddress('acme', 'Refunds', 'claude_1234abcd')).toBe('acme/refunds')
    expect(hqChatAddress('acme', null, 'claude_1234abcd', { role: 'worker' })).toBe(
      'acme/w-1234abcd'
    )
  })
})
