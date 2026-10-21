import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HqWaitingReplyRef } from '../../../../../shared/hq-waiting-reply-bell'

const mocks = vi.hoisted(() => ({
  open: vi.fn(async () => {}),
  pass: vi.fn(),
  skip: vi.fn(async () => {}),
  success: vi.fn(),
  error: vi.fn()
}))

vi.mock('../hq/hq-history-open', () => ({ openHqHistoryEntry: mocks.open }))
vi.mock('sonner', () => ({ toast: { success: mocks.success, error: mocks.error } }))
vi.mock('@/i18n/i18n', () => ({ translate: (_key: string, fallback: string) => fallback }))

import { passHqWaitingReply, runHqWaitingReplyAction } from './hq-waiting-reply-actions'

const ref: HqWaitingReplyRef = {
  waitingId: 'w1',
  sessionId: 's1',
  worktreeId: 'wt1',
  project: 'voice',
  question: 'Phone hours',
  askedAt: 1,
  author: 'Анна',
  replyTs: '1.1',
  reply: 'Sun–Thu',
  link: null
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('window', {
    api: { pulseBell: { passWaitingReply: mocks.pass, skipWaitingReply: mocks.skip } }
  })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('passHqWaitingReply', () => {
  it('passes the answer straight to a live chat', async () => {
    mocks.pass.mockResolvedValueOnce({ ok: true })
    expect(await passHqWaitingReply(ref)).toBe(true)
    expect(mocks.open).not.toHaveBeenCalled()
    expect(mocks.success).toHaveBeenCalled()
  })

  it('brings a closed chat back and tries again until it takes the answer', async () => {
    mocks.pass
      .mockResolvedValueOnce({ ok: false, reason: 'chat-closed' })
      .mockResolvedValueOnce({ ok: false, reason: 'chat-closed' })
      .mockResolvedValueOnce({ ok: true })
    const passed = passHqWaitingReply(ref)
    await vi.advanceTimersByTimeAsync(3_000)
    expect(await passed).toBe(true)
    expect(mocks.open).toHaveBeenCalledWith({
      worktreeId: 'wt1',
      sessionId: 's1',
      tabId: 'structured-agent-session-s1'
    })
    expect(mocks.pass).toHaveBeenCalledTimes(3)
  })

  it('says so when the answer was already handled', async () => {
    mocks.pass.mockResolvedValueOnce({ ok: false, reason: 'gone' })
    expect(await passHqWaitingReply(ref)).toBe(false)
    expect(mocks.error).toHaveBeenCalledWith('This answer was already handled')
  })
})

describe('runHqWaitingReplyAction', () => {
  it('skips without passing anything on', async () => {
    await runHqWaitingReplyAction(ref, 'reply-skip')
    expect(mocks.skip).toHaveBeenCalledWith('w1')
    expect(mocks.pass).not.toHaveBeenCalled()
  })
})
