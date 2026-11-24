import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  provideChatCloseWorktreeSweep,
  readSweepOutcome,
  sweepClosedChatWorktree,
  sweepWorktreeAfterChatClose,
  type ChatCloseSweepDeps
} from './chat-close-worktree-sweep'
import type { StructuredSessionSurface } from '../../runtime/agent-session/lifecycle/structured-agent-session-close'

const WT = 'repo-1::/work/acme-feat'

function deps(patch: Partial<ChatCloseSweepDeps> = {}): ChatCloseSweepDeps {
  return {
    enabled: () => true,
    isMainCheckout: () => false,
    openTabs: () => 0,
    stillRunning: () => false,
    runSweep: vi.fn(async () =>
      JSON.stringify({
        rows: [{ path: '/work/acme-feat', reasons: [], remove: true }],
        results: [{ path: '/work/acme-feat', result: { ok: true, backup: 'refs/x' } }]
      })
    ),
    log: vi.fn(),
    delayMs: 1_000,
    ...patch
  }
}

function surface(worktreeId: string | null): StructuredSessionSurface {
  return {
    tableId: 'tab-1',
    presentation: {
      raw: worktreeId ? { worktreeId, tabId: 'tab-1' } : null,
      saved: []
    }
  } as unknown as StructuredSessionSurface
}

afterEach(() => {
  provideChatCloseWorktreeSweep(null)
  vi.useRealTimers()
})

describe('worktree sweep after a chat close', () => {
  it('runs the sweep on that one worktree with no day of quiet', async () => {
    const d = deps()
    expect(await sweepClosedChatWorktree(d, 's1', WT)).toEqual({
      kind: 'removed',
      backup: 'refs/x'
    })
    expect(d.runSweep).toHaveBeenCalledWith([
      '--worktree',
      '/work/acme-feat',
      '--closed-chat',
      '--fetch',
      '--apply',
      '--json'
    ])
  })

  it('leaves the main checkout, a chat that still runs and a worktree with another tab open', async () => {
    for (const [patch, why] of [
      [{ isMainCheckout: () => true }, 'main checkout'],
      [{ stillRunning: () => true }, 'the chat still runs'],
      [{ openTabs: () => 2 }, '2 other tab(s) open in it']
    ] as const) {
      const d = deps(patch)
      expect(await sweepClosedChatWorktree(d, 's1', WT)).toEqual({ kind: 'skipped', why })
      expect(d.runSweep).not.toHaveBeenCalled()
    }
    expect(await sweepClosedChatWorktree(deps(), 's1', 'no-separator')).toEqual({
      kind: 'skipped',
      why: 'not a repo worktree'
    })
  })

  it('reads why the sweep kept it', () => {
    expect(
      readSweepOutcome(
        JSON.stringify({
          rows: [{ path: '/w', reasons: ['has work not in the base branch'], remove: false }],
          results: []
        }),
        '/w'
      )
    ).toEqual({ kind: 'kept', reasons: ['has work not in the base branch'] })
    expect(
      readSweepOutcome(
        JSON.stringify({
          rows: [{ remove: true }],
          results: [{ result: { ok: false, step: 'remove' } }]
        }),
        '/w'
      )
    ).toEqual({ kind: 'kept', reasons: ['removal failed at remove'] })
    expect(readSweepOutcome(JSON.stringify({ rows: [], results: [] }), '/w').kind).toBe('skipped')
    expect(readSweepOutcome('not json', '/w')).toEqual({
      kind: 'skipped',
      why: 'unreadable sweep output'
    })
  })

  it('waits before sweeping, once per worktree however many closes come in', async () => {
    vi.useFakeTimers()
    const d = deps()
    provideChatCloseWorktreeSweep(d)
    sweepWorktreeAfterChatClose('s1', surface(WT))
    sweepWorktreeAfterChatClose('s1', surface(WT))
    await vi.advanceTimersByTimeAsync(999)
    expect(d.runSweep).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(d.runSweep).toHaveBeenCalledTimes(1)
    await vi.waitFor(() => expect(d.log).toHaveBeenCalledWith('removed', expect.anything()))
  })

  it('does nothing when switched off, unprovided or the chat had no worktree', async () => {
    vi.useFakeTimers()
    const off = deps({ enabled: () => false })
    provideChatCloseWorktreeSweep(off)
    sweepWorktreeAfterChatClose('s1', surface(WT))
    const none = deps()
    provideChatCloseWorktreeSweep(none)
    sweepWorktreeAfterChatClose('s1', surface(null))
    sweepWorktreeAfterChatClose('s1', null)
    provideChatCloseWorktreeSweep(null)
    sweepWorktreeAfterChatClose('s1', surface(WT))
    await vi.advanceTimersByTimeAsync(5_000)
    expect(off.runSweep).not.toHaveBeenCalled()
    expect(none.runSweep).not.toHaveBeenCalled()
  })
})
