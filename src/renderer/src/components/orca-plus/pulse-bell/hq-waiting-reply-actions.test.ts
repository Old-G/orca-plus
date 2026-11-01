import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HqWaitingReplyRef } from '../../../../../shared/hq-waiting-reply-bell'

const mocks = vi.hoisted(() => ({
  open: vi.fn(async () => {}),
  pass: vi.fn(),
  skip: vi.fn(async () => {}),
  success: vi.fn(),
  error: vi.fn(),
  offer: vi.fn(),
  start: vi.fn()
}))

vi.mock('../hq/hq-history-open', () => ({ openHqHistoryEntry: mocks.open }))
vi.mock('sonner', () => ({
  toast: Object.assign(mocks.offer, { success: mocks.success, error: mocks.error })
}))
vi.mock('@/store', () => ({
  useAppStore: {
    getState: () => ({ unifiedTabsByWorktree: { wt2: [{ id: 'structured-agent-session-s2' }] } })
  }
}))
vi.mock('../hq/hq-ask-chat', () => ({ startHqChatWithPrompt: mocks.start }))
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

  it('offers Reopen or New chat when the live end of the chain is closed', async () => {
    mocks.pass.mockResolvedValueOnce({
      ok: false,
      reason: 'chat-closed',
      liveSessionId: 's2',
      prompt: 'Анна answered: Sun–Thu'
    })
    expect(await passHqWaitingReply(ref)).toBe(false)
    expect(mocks.open).not.toHaveBeenCalled()
    const options = mocks.offer.mock.calls[0]?.[1] as {
      action: { label: string; onClick: () => void }
      cancel: { label: string; onClick: () => void }
    }
    expect([options.action.label, options.cancel.label]).toEqual(['Reopen', 'New chat'])
    mocks.start.mockResolvedValueOnce({ ok: true, chat: null })
    options.cancel.onClick()
    await vi.advanceTimersByTimeAsync(0)
    expect(mocks.start).toHaveBeenCalledWith('wt2', 'Анна answered: Sun–Thu', 'Анна: answer')
    expect(mocks.skip).toHaveBeenCalledWith('w1', '1.1')
    mocks.pass.mockResolvedValueOnce({ ok: false, reason: 'chat-closed' })
    mocks.pass.mockResolvedValueOnce({ ok: true })
    options.action.onClick()
    await vi.advanceTimersByTimeAsync(2_000)
    expect(mocks.open).toHaveBeenCalledWith({
      worktreeId: 'wt2',
      sessionId: 's2',
      tabId: 'structured-agent-session-s2'
    })
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
    expect(mocks.skip).toHaveBeenCalledWith('w1', '1.1')
    expect(mocks.pass).not.toHaveBeenCalled()
  })
})
