import { describe, expect, it, vi } from 'vitest'
import { createClaudeHandoffClaims } from './claude-handoff-claims'

const published = vi.hoisted(() => [] as unknown[])
vi.mock('../runtime/orchestration/workers/launch/worker-start-card', () => ({
  prepareAgentCreationCard: (from: string) => (card: () => unknown) =>
    published.push({ from, card: card() }),
  startedAgentSender: (_runtime: unknown, address: string) => ({ address })
}))

const { startClaudeHandoffOnce } = await import('./claude-handoff-start-once')

function run(over: Partial<Parameters<typeof startClaudeHandoffOnce>[0]> = {}) {
  const start = vi.fn(async () => ({
    ok: true as const,
    tabId: 'structured-agent-session-claude_new'
  }))
  const dismiss = vi.fn()
  const claims = createClaudeHandoffClaims(() => 0)
  const args = {
    fromSessionId: 'claude_old',
    ownStarted: async () => false,
    dismiss,
    start,
    card: { runtime: {} as never, task: 'Continue from handoff-x.md' },
    claims,
    ...over
  }
  return { args, start, dismiss, claims: args.claims }
}

describe('startClaudeHandoffOnce', () => {
  it('starts the new chat, shows it in the old one, and turns the chat’s own launch away', async () => {
    published.length = 0
    const { args, start, claims } = run()
    expect(await startClaudeHandoffOnce(args)).toEqual({
      ok: true,
      tabId: 'structured-agent-session-claude_new'
    })
    expect(start).toHaveBeenCalledTimes(1)
    expect(published).toEqual([
      {
        from: 'claude_old',
        card: expect.objectContaining({
          kind: 'agent-handoff',
          agent: { address: 'orca_session_id:claude_new' },
          task: 'Continue from handoff-x.md'
        })
      }
    ])
    expect(claims.claimForAgent('claude_old')).toEqual({
      taken: true,
      successorSessionId: 'claude_new'
    })
  })

  it('leaves it to the chat that is starting its own, and keeps the offer should that fail', async () => {
    const { args, start, dismiss, claims } = run()
    claims.claimForAgent('claude_old')
    expect(await startClaudeHandoffOnce(args)).toMatchObject({ ok: false })
    expect(start).not.toHaveBeenCalled()
    expect(dismiss).not.toHaveBeenCalled()
  })

  it('drops the offer when the chat already started its own', async () => {
    const { args, start, dismiss } = run({ ownStarted: async () => true })
    expect(await startClaudeHandoffOnce(args)).toMatchObject({ ok: false })
    expect(start).not.toHaveBeenCalled()
    expect(dismiss).toHaveBeenCalled()
  })

  it('a failed start frees the handoff for the chat’s own launch', async () => {
    const { args, claims } = run({ start: async () => ({ ok: false, error: 'no host' }) })
    expect(await startClaudeHandoffOnce(args)).toEqual({ ok: false, error: 'no host' })
    expect(claims.claimForAgent('claude_old')).toEqual({ taken: false })
  })
})
