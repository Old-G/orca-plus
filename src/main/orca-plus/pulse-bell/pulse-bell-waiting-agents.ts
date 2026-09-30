// Custom build (pulse-bell): tracks agents that wait on the user, from the hook server's status feed.
import type { EnrichedAgentHookEventPayload } from '../../agent-hooks/server/server-types'
import type { WaitingAgent } from '../../../shared/pulse-bell'

const ASK_USER_QUESTION_TOOL = 'AskUserQuestion'

export type WaitingAgentsTracker = {
  /** True when the set of waiting agents changed. */
  onStatus: (event: EnrichedAgentHookEventPayload) => boolean
  /** The pane closed or its status row was dropped; true when it was waiting. */
  onCleared: (paneKey: string) => boolean
  list: () => WaitingAgent[]
}

export function createWaitingAgentsTracker(
  describeWorktree: (worktreeId: string) => string
): WaitingAgentsTracker {
  const waiting = new Map<string, WaitingAgent>()
  return {
    onStatus: (event) => {
      const state = event.payload.state
      const current = waiting.get(event.paneKey)
      if (state !== 'blocked' && state !== 'waiting') {
        return waiting.delete(event.paneKey)
      }
      // Why: restored-at-startup rows are not yet confirmed live; the next real event decides.
      if (event.restoredUnconfirmed) {
        return false
      }
      // Why: Claude reports a permission prompt as `waiting` with the tool; other agents use `blocked`.
      const toolName = event.payload.toolName
      const blocked =
        state === 'blocked' || Boolean(toolName && toolName !== ASK_USER_QUESTION_TOOL)
      if (current && current.blocked === blocked) {
        return false
      }
      waiting.set(event.paneKey, {
        paneKey: event.paneKey,
        tabId: event.tabId ?? null,
        worktreeId: event.worktreeId ?? null,
        worktreeTitle: event.worktreeId ? describeWorktree(event.worktreeId) : null,
        agentType: event.payload.agentType ?? null,
        blocked,
        prompt: event.payload.prompt || null,
        since: event.stateStartedAt
      })
      return true
    },
    onCleared: (paneKey) => waiting.delete(paneKey),
    list: () => [...waiting.values()]
  }
}
