import { describe, expect, it } from 'vitest'
import {
  lastNativeChatActivityAt,
  nativeChatContinueNewDue,
  nativeChatContinueNewDueAt
} from './native-chat-continue-new'

const HOUR = 60 * 60_000
const now = 10 * HOUR

describe('nativeChatContinueNewDue', () => {
  it('is due for a chat over 200k left idle over an hour', () => {
    expect(
      nativeChatContinueNewDue({
        usedTokens: 420_000,
        lastActivityAt: now - 3 * HOUR,
        isWorking: false,
        now
      })
    ).toBe(true)
  })
  it('is not due at 200k or below', () => {
    expect(
      nativeChatContinueNewDue({
        usedTokens: 200_000,
        lastActivityAt: now - 3 * HOUR,
        isWorking: false,
        now
      })
    ).toBe(false)
  })
  it('is not due within the hour the cache lives', () => {
    expect(
      nativeChatContinueNewDue({
        usedTokens: 600_000,
        lastActivityAt: now - 59 * 60_000,
        isWorking: false,
        now
      })
    ).toBe(false)
  })
  it('is not due while the chat works or when its size or last message is unknown', () => {
    const base = { usedTokens: 600_000, lastActivityAt: now - 2 * HOUR, isWorking: false, now }
    expect(nativeChatContinueNewDue({ ...base, isWorking: true })).toBe(false)
    expect(nativeChatContinueNewDue({ ...base, usedTokens: null })).toBe(false)
    expect(nativeChatContinueNewDue({ ...base, lastActivityAt: null })).toBe(false)
  })
})

describe('nativeChatContinueNewDueAt', () => {
  it('names the moment a big chat becomes due, and never for a small or working one', () => {
    const due = nativeChatContinueNewDueAt({
      usedTokens: 300_000,
      lastActivityAt: now,
      isWorking: false
    })
    expect(due).toBe(now + HOUR + 1)
    expect(
      nativeChatContinueNewDue({
        usedTokens: 300_000,
        lastActivityAt: now,
        isWorking: false,
        now: due ?? 0
      })
    ).toBe(true)
    expect(
      nativeChatContinueNewDueAt({ usedTokens: 100_000, lastActivityAt: now, isWorking: false })
    ).toBe(null)
    expect(
      nativeChatContinueNewDueAt({ usedTokens: 300_000, lastActivityAt: now, isWorking: true })
    ).toBe(null)
  })
})

describe('lastNativeChatActivityAt', () => {
  it('takes the newest timestamp and skips messages without one', () => {
    expect(
      lastNativeChatActivityAt([
        { timestamp: 5 },
        { timestamp: null },
        { timestamp: 9 },
        { timestamp: 7 }
      ])
    ).toBe(9)
    expect(lastNativeChatActivityAt([{ timestamp: null }])).toBe(null)
  })
})
