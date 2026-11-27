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

describe('every start path at once (hq-handoff-once)', () => {
  it('opens exactly one new chat when the sweep, a click, «Continue» and the chat itself race', async () => {
    let clock = 0
    const journal = new Map<string, string>()
    const claims = createClaudeHandoffClaims(
      () => clock,
      () => (from) => journal.get(from) ?? null
    )
    let opened = 0
    const start = async () => {
      // The launch takes a while; the others arrive meanwhile.
      await new Promise((resolve) => setTimeout(resolve, 5))
      opened += 1
      journal.set('claude_old', `claude_new_${opened}`)
      return { ok: true as const, tabId: `structured-agent-session-claude_new_${opened}` }
    }
    const orcaStart = () =>
      startClaudeHandoffOnce({
        fromSessionId: 'claude_old',
        ownStarted: async () => false,
        dismiss: () => undefined,
        start,
        claims
      })
    const agentStart = async () => {
      await Promise.resolve()
      return claims.claimForAgent('claude_old').taken ? 'refused' : 'launched'
    }
    const results = await Promise.all([orcaStart(), orcaStart(), orcaStart(), agentStart()])
    expect(opened).toBe(1)
    expect(results.filter((result) => typeof result === 'object' && result.ok)).toHaveLength(1)
    expect(results[3]).toBe('refused')
    // Minutes later, every claim gone from memory: the journal still says it is continued.
    clock += 10 * 60_000
    expect(await orcaStart()).toMatchObject({ ok: false })
    expect(claims.claimForAgent('claude_old')).toMatchObject({ taken: true })
    expect(opened).toBe(1)
  })

  it('the chat’s own start first: Orca+ starts nothing and drops the offer', async () => {
    const journal = new Map<string, string>()
    const claims = createClaudeHandoffClaims(
      () => 0,
      () => (from) => journal.get(from) ?? null
    )
    expect(claims.claimForAgent('claude_old')).toEqual({ taken: false })
    journal.set('claude_old', 'claude_own')
    const { args, start, dismiss } = run({ claims })
    expect(await startClaudeHandoffOnce(args)).toMatchObject({ ok: false })
    expect(start).not.toHaveBeenCalled()
    expect(dismiss).toHaveBeenCalled()
  })
})
