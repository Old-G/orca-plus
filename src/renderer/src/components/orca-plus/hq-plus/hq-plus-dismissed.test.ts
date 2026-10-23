import { describe, expect, it } from 'vitest'
import { hqPlusChatCardShown } from './hq-plus-dismissed'

describe('hqPlusChatCardShown', () => {
  it('hides a dismissed card until the chat posts again', () => {
    const dismissed = new Map([['chat-1', 100]])
    expect(hqPlusChatCardShown(dismissed, 'chat-1', 100)).toBe(false)
    expect(hqPlusChatCardShown(dismissed, 'chat-1', 101)).toBe(true)
    expect(hqPlusChatCardShown(dismissed, 'chat-2', 50)).toBe(true)
  })
})
