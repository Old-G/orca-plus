import { describe, expect, it, vi } from 'vitest'
import type { EnrichedAgentHookEventPayload } from '../agent-hooks/server/server-types'
import { createClaudeHandoffOffers } from './claude-handoff-offers'

const SESSION = 'session-a'
const WORKTREE = 'repo-1::/work/orca'
const NOW = Date.parse('2026-09-27T12:00:00+03:00')

function fileText(created = '2026-09-27T11:50:00+03:00', session = SESSION): string {
  return [
    '---',
    'type: strata-handoff',
    `session: ${session}`,
    `created: ${created}`,
    'branch: custom',
    'head: abc1234',
    'pushed: no',
    '---',
    '## Prompt',
    '```text',
    'Continue the plan.',
    '```',
    ''
  ].join('\n')
}

function stop(
  overrides: Partial<EnrichedAgentHookEventPayload> = {}
): EnrichedAgentHookEventPayload {
  return {
    paneKey: 'tab-1:leaf-1',
    connectionId: null,
    worktreeId: WORKTREE,
    providerSession: { key: 'session_id', id: SESSION },
    receivedAt: NOW,
    stateStartedAt: NOW,
    payload: { state: 'done', prompt: '', agentType: 'claude' },
    ...overrides
  }
}

function setup(files: Record<string, string | null> = {}) {
  const readWorktreeFile = vi.fn(
    async (_worktreeId: string, relativePath: string) => files[relativePath] ?? null
  )
  const onOffersChanged = vi.fn()
  const offers = createClaudeHandoffOffers({
    readWorktreeFile,
    describeWorktree: () => 'orca / custom',
    onOffersChanged,
    now: () => NOW
  })
  return { offers, readWorktreeFile, onOffersChanged, files }
}

const PATH = `.claude/handoff/handoff-${SESSION}.md`

describe('createClaudeHandoffOffers', () => {
  it('offers a fresh handoff once a Claude turn is done', async () => {
    const { offers, onOffersChanged } = setup({ [PATH]: fileText() })
    await offers.onStatus(stop())
    expect(offers.list()).toEqual([
      {
        id: SESSION,
        worktreeId: WORKTREE,
        worktreeTitle: 'orca / custom',
        sessionId: SESSION,
        created: '2026-09-27T11:50:00+03:00',
        branch: 'custom',
        head: 'abc1234',
        pushed: 'no'
      }
    ])
    expect(onOffersChanged).toHaveBeenCalledTimes(1)
  })

  it('does nothing when the session left no handoff', async () => {
    const { offers, onOffersChanged } = setup()
    await offers.onStatus(stop())
    expect(offers.list()).toEqual([])
    expect(onOffersChanged).not.toHaveBeenCalled()
  })

  it('ignores other agents, unfinished turns, replays and events without a session', async () => {
    const { offers, readWorktreeFile } = setup({ [PATH]: fileText() })
    await offers.onStatus(stop({ payload: { state: 'done', prompt: '', agentType: 'codex' } }))
    await offers.onStatus(stop({ payload: { state: 'working', prompt: '', agentType: 'claude' } }))
    await offers.onStatus(stop({ isReplay: true }))
    await offers.onStatus(stop({ restoredUnconfirmed: true }))
    await offers.onStatus(stop({ providerSession: undefined }))
    await offers.onStatus(stop({ worktreeId: undefined }))
    expect(readWorktreeFile).not.toHaveBeenCalled()
    expect(offers.list()).toEqual([])
  })

  it('skips a leftover handoff older than the turn that just ended', async () => {
    const { offers } = setup({ [PATH]: fileText('2026-09-27T10:00:00+03:00') })
    await offers.onStatus(stop())
    expect(offers.list()).toEqual([])
  })

  it('offers one handoff once, even after it was dismissed and the session stops again', async () => {
    const { offers, onOffersChanged } = setup({ [PATH]: fileText() })
    await offers.onStatus(stop())
    offers.dismiss(SESSION)
    await offers.onStatus(stop())
    expect(offers.list()).toEqual([])
    expect(onOffersChanged).toHaveBeenCalledTimes(2)
  })

  it('offers again when the session writes a newer handoff', async () => {
    const setupResult = setup({ [PATH]: fileText() })
    await setupResult.offers.onStatus(stop())
    setupResult.files[PATH] = fileText('2026-09-27T11:55:00+03:00')
    await setupResult.offers.onStatus(stop())
    expect(setupResult.offers.list().map((offer) => offer.created)).toEqual([
      '2026-09-27T11:55:00+03:00'
    ])
  })

  it('resolves the prompt from the file as it is at launch time', async () => {
    const setupResult = setup({ [PATH]: fileText() })
    await setupResult.offers.onStatus(stop())
    expect((await setupResult.offers.resolve(SESSION))?.file.prompt).toBe('Continue the plan.')
    setupResult.files[PATH] = null
    expect(await setupResult.offers.resolve(SESSION)).toBeNull()
    expect(await setupResult.offers.resolve('unknown')).toBeNull()
  })

  it('never reads a path built from an unsafe session id', async () => {
    const { offers, readWorktreeFile } = setup()
    await offers.onStatus(stop({ providerSession: { key: 'session_id', id: '../x' } }))
    expect(readWorktreeFile).not.toHaveBeenCalled()
  })

  it('treats an unreadable host as no handoff', async () => {
    const onOffersChanged = vi.fn()
    const offers = createClaudeHandoffOffers({
      readWorktreeFile: async () => {
        throw new Error('ssh gone')
      },
      describeWorktree: () => 'x',
      onOffersChanged,
      now: () => NOW
    })
    await offers.onStatus(stop())
    expect(offers.list()).toEqual([])
  })

  it('offers the handoff of a turn a usage limit cut off, measured from the stop', async () => {
    const { offers, onOffersChanged } = setup({ [PATH]: fileText('2026-09-27T11:50:00+03:00') })
    const stoppedAt = Date.parse('2026-09-27T11:50:03+03:00')
    // The limit lifts hours later: the file is old by now, but it belongs to the stopped turn.
    expect(await offers.checkStoppedSession(WORKTREE, SESSION, stoppedAt)).toBe(true)
    expect(offers.list()).toEqual([expect.objectContaining({ id: SESSION, worktreeId: WORKTREE })])
    expect(await offers.checkStoppedSession(WORKTREE, SESSION, stoppedAt)).toBe(true)
    expect(onOffersChanged).toHaveBeenCalledTimes(1)
  })

  it('does not tie a handoff from an earlier turn to a later limit stop', async () => {
    const { offers } = setup({ [PATH]: fileText('2026-09-27T09:00:00+03:00') })
    expect(await offers.checkStoppedSession(WORKTREE, SESSION, NOW)).toBe(false)
    expect(await setup().offers.checkStoppedSession(WORKTREE, SESSION, NOW)).toBe(false)
    expect(offers.list()).toEqual([])
  })
})
