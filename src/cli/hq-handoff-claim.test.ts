import { afterEach, describe, expect, it, vi } from 'vitest'
import { continuesOwnHandoff, handoffStartedByOrca } from './hq-handoff-claim'

const PROMPT = 'Continue from .claude/handoff/handoff-1a2b3c.md: read it first.'

afterEach(() => vi.unstubAllEnvs())

describe('handoffStartedByOrca', () => {
  it('stops a second start of a handoff Orca+ already started', async () => {
    vi.stubEnv('ORCA_AGENT_SESSION_ID', 'claude_old')
    const call = vi.fn().mockResolvedValue({
      result: { taken: true, successorSessionId: 'claude_new' }
    })
    expect(await handoffStartedByOrca({ call, isRemote: false }, PROMPT)).toBe(
      "Orca+ already started this handoff's new chat: claude_new; not starting a second one."
    )
    expect(call).toHaveBeenCalledWith('hq.handoffClaim', { callerSessionId: 'claude_old' })
  })

  it('launches when the handoff is free, the host cannot tell, or the prompt is no handoff', async () => {
    vi.stubEnv('ORCA_AGENT_SESSION_ID', 'claude_old')
    const free = vi.fn().mockResolvedValue({ result: { taken: false } })
    expect(await handoffStartedByOrca({ call: free, isRemote: false }, PROMPT)).toBeNull()
    const older = vi.fn().mockRejectedValue(new Error('unknown method'))
    expect(await handoffStartedByOrca({ call: older, isRemote: false }, PROMPT)).toBeNull()
    const other = vi.fn()
    expect(await handoffStartedByOrca({ call: other, isRemote: false }, 'Fix the tests')).toBeNull()
    expect(other).not.toHaveBeenCalled()
  })
})

describe('continuesOwnHandoff (hq-handoff-parked)', () => {
  it("is true only for the calling chat's own handoff file", () => {
    vi.stubEnv('CLAUDE_CODE_SESSION_ID', '1a2b3c')
    expect(continuesOwnHandoff(PROMPT)).toBe(true)
    // Why: a Lead relaunching a worker's handoff is not that worker's successor itself.
    expect(continuesOwnHandoff('Continue from .claude/handoff/handoff-9z9z.md')).toBe(false)
    expect(continuesOwnHandoff('Fix the tests, see handoff-1a2b3c.md')).toBe(false)
    expect(continuesOwnHandoff(undefined)).toBe(false)
    vi.stubEnv('CLAUDE_CODE_SESSION_ID', '')
    expect(continuesOwnHandoff(PROMPT)).toBe(false)
  })
})
