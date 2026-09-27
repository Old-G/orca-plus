import { describe, expect, it, vi } from 'vitest'
import type { EnrichedAgentHookEventPayload } from '../agent-hooks/server/server-types'
import { createClaudeHandoffOffers, type ClaudeHandoffHandledStore } from './claude-handoff-offers'

const SESSION = 'session-a'
const WORKTREE = 'repo-1::/work/orca'
const NOW = Date.parse('2026-09-27T12:00:00+03:00')
const PATH = `.claude/handoff/handoff-${SESSION}.md`
const FILE = [
  '---',
  'type: strata-handoff',
  `session: ${SESSION}`,
  'created: 2026-09-27T11:50:00+03:00',
  '---',
  '## Prompt',
  '```text',
  'Continue the plan.',
  '```',
  ''
].join('\n')

const stop: EnrichedAgentHookEventPayload = {
  paneKey: 'tab-1:leaf-1',
  connectionId: null,
  worktreeId: WORKTREE,
  providerSession: { key: 'session_id', id: SESSION },
  receivedAt: NOW,
  stateStartedAt: NOW,
  payload: { state: 'done', prompt: '', agentType: 'claude' }
}

function memoryStore(): ClaudeHandoffHandledStore & { keys: Set<string> } {
  const keys = new Set<string>()
  return { keys, has: (key) => keys.has(key), add: (key) => void keys.add(key) }
}

function setup(options: {
  contextGateFired?: boolean | null
  handled?: ClaudeHandoffHandledStore
}) {
  return createClaudeHandoffOffers({
    readWorktreeFile: vi.fn(async (_id: string, path: string) => (path === PATH ? FILE : null)),
    describeWorktree: () => 'orca / custom',
    onOffersChanged: vi.fn(),
    now: () => NOW,
    contextGateFired: async () => options.contextGateFired ?? null,
    handled: options.handled
  })
}

// Custom build (claude-handoff-launch): a new session is offered only when the context really filled.
describe('handoff offer gating', () => {
  it('offers when the context gate fired for the session', async () => {
    const offers = setup({ contextGateFired: true })
    await offers.onStatus(stop)
    expect(offers.list()).toHaveLength(1)
  })

  it('does not offer a handoff written while the context was not filling up', async () => {
    const offers = setup({ contextGateFired: false })
    await offers.onStatus(stop)
    expect(await offers.checkStoppedSession(WORKTREE, SESSION, NOW)).toBe(false)
    expect(offers.list()).toEqual([])
  })

  it('still offers when the gate cannot be read, e.g. on an SSH host', async () => {
    const offers = setup({ contextGateFired: null })
    await offers.onStatus(stop)
    expect(offers.list()).toHaveLength(1)
  })

  it('does not offer again after a restart once the handoff was launched or dismissed', async () => {
    const handled = memoryStore()
    const before = setup({ contextGateFired: true, handled })
    await before.onStatus(stop)
    before.dismiss(SESSION)
    expect(handled.keys.size).toBe(1)

    const afterRestart = setup({ contextGateFired: true, handled })
    await afterRestart.onStatus(stop)
    expect(await afterRestart.checkStoppedSession(WORKTREE, SESSION, NOW)).toBe(true)
    expect(afterRestart.list()).toEqual([])
  })

  it('offers an unanswered handoff again after a restart', async () => {
    const handled = memoryStore()
    await setup({ contextGateFired: true, handled }).onStatus(stop)
    const afterRestart = setup({ contextGateFired: true, handled })
    await afterRestart.onStatus(stop)
    expect(afterRestart.list()).toHaveLength(1)
  })
})
