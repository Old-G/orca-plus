import { describe, expect, it, vi } from 'vitest'
import { createClaudeContinueChat } from './claude-handoff-continue-chat'

const TAB = 'structured-agent-session-claude_abc'

describe('createClaudeContinueChat', () => {
  it('starts the successor beside the chat with the prompt the window built', async () => {
    const start = vi.fn().mockResolvedValue({ ok: true, worktreeId: 'w1', tabId: 'new' })
    const result = await createClaudeContinueChat(start)('w1', TAB, 'Continue work…')
    expect(start).toHaveBeenCalledWith({
      worktreeId: 'w1',
      from: { worktreeId: 'w1', tabId: TAB },
      prompt: 'Continue work…'
    })
    expect(result).toEqual({ ok: true, worktreeId: 'w1', tabId: 'new' })
  })

  it('refuses a tab that is not a native chat, an empty prompt or a missing workspace', async () => {
    const start = vi.fn()
    const run = createClaudeContinueChat(start)
    for (const args of [
      ['w1', 'terminal-1', 'p'],
      ['w1', 'structured-agent-session-', 'p'],
      ['w1', TAB, '   '],
      ['', TAB, 'p'],
      [42, TAB, 'p']
    ] as const) {
      expect((await run(args[0], args[1], args[2])).ok).toBe(false)
    }
    expect(start).not.toHaveBeenCalled()
  })

  it('starts one successor per chat at a time', async () => {
    let finish: (value: { ok: true; worktreeId: string }) => void = () => {}
    const start = vi.fn(
      () => new Promise<{ ok: true; worktreeId: string }>((resolve) => (finish = resolve))
    )
    const run = createClaudeContinueChat(start)
    const first = run('w1', TAB, 'p')
    expect(await run('w1', TAB, 'p')).toEqual({
      ok: false,
      error: 'The new chat is already starting.'
    })
    finish({ ok: true, worktreeId: 'w1' })
    expect((await first).ok).toBe(true)
    // Once settled, the chat may be continued again (e.g. after a failed start).
    void run('w1', TAB, 'p')
    expect(start).toHaveBeenCalledTimes(2)
  })
})
