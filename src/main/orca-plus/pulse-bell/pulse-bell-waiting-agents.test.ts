import { describe, expect, it } from 'vitest'
import type { EnrichedAgentHookEventPayload } from '../../agent-hooks/server/server-types'
import type { AgentStatusState } from '../../../shared/agent-status-types'
import { createWaitingAgentsTracker } from './pulse-bell-waiting-agents'

function status(
  state: AgentStatusState,
  extra: Partial<EnrichedAgentHookEventPayload> = {}
): EnrichedAgentHookEventPayload {
  return {
    paneKey: 'tab-1:leaf-1',
    tabId: 'tab-1',
    worktreeId: 'wt-1',
    connectionId: null,
    receivedAt: 5_000,
    stateStartedAt: 4_000,
    payload: { state, agentType: 'claude', prompt: 'Allow rm -rf build?' },
    ...extra
  }
}

describe('createWaitingAgentsTracker', () => {
  it('tracks an agent while it is blocked or waiting, and drops it on any other state', () => {
    const tracker = createWaitingAgentsTracker((id) => `title of ${id}`)
    expect(tracker.onStatus(status('blocked'))).toBe(true)
    expect(tracker.list()).toEqual([
      {
        paneKey: 'tab-1:leaf-1',
        tabId: 'tab-1',
        worktreeId: 'wt-1',
        worktreeTitle: 'title of wt-1',
        agentType: 'claude',
        blocked: true,
        prompt: 'Allow rm -rf build?',
        since: 4_000
      }
    ])
    expect(tracker.onStatus(status('blocked'))).toBe(false)
    expect(tracker.onStatus(status('waiting', { stateStartedAt: 6_000 }))).toBe(true)
    expect(tracker.list()[0]).toMatchObject({ blocked: false, since: 6_000 })
    expect(tracker.onStatus(status('working'))).toBe(true)
    expect(tracker.list()).toEqual([])
    expect(tracker.onStatus(status('done'))).toBe(false)
  })

  it('treats a waiting row with a tool as a permission prompt, but not a question', () => {
    const tracker = createWaitingAgentsTracker(() => 'wt')
    const withTool = (toolName: string) =>
      status('waiting', {
        payload: { state: 'waiting', agentType: 'claude', prompt: '', toolName }
      })
    tracker.onStatus(withTool('Bash'))
    expect(tracker.list()[0]?.blocked).toBe(true)
    tracker.onStatus(withTool('AskUserQuestion'))
    expect(tracker.list()[0]?.blocked).toBe(false)
  })

  it('forgets a waiting agent whose pane closed', () => {
    const tracker = createWaitingAgentsTracker(() => 'wt')
    tracker.onStatus(status('waiting'))
    expect(tracker.onCleared('other-pane')).toBe(false)
    expect(tracker.onCleared('tab-1:leaf-1')).toBe(true)
    expect(tracker.list()).toEqual([])
  })

  it('ignores rows restored at startup until a live event confirms them', () => {
    const tracker = createWaitingAgentsTracker(() => 'wt')
    expect(tracker.onStatus(status('blocked', { restoredUnconfirmed: true }))).toBe(false)
    expect(tracker.list()).toEqual([])
    expect(tracker.onStatus(status('blocked'))).toBe(true)
  })
})
