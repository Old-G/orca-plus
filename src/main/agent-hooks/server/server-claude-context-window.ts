import type { HookListenerState } from '../../../shared/agent-hook-listener/listener-state'
import type { AgentStatusIpcPayload } from '../../../shared/agent-status-types'
import type { ClaudeContextWindow } from '../../../shared/claude-statusline-context-window'

// Why: a statusline may post before its pane has a row, so entries are not tied to rows; bound them.
export const MAX_CLAUDE_CONTEXT_WINDOW_PANES = 256

export function recordClaudeContextWindow(
  state: HookListenerState,
  paneKey: string,
  contextWindow: ClaudeContextWindow
): void {
  const map = state.claudeContextWindowByPaneKey
  // Why: delete-then-set keeps insertion order as recency, so eviction drops the quietest pane.
  map.delete(paneKey)
  map.set(paneKey, contextWindow)
  while (map.size > MAX_CLAUDE_CONTEXT_WINDOW_PANES) {
    const oldest = map.keys().next().value
    if (oldest === undefined) {
      break
    }
    map.delete(oldest)
  }
}

/** Only a Claude row takes it: a pane that switched agents must not show Claude's old gauge. */
export function withClaudeContextWindow(
  state: HookListenerState,
  row: AgentStatusIpcPayload
): AgentStatusIpcPayload {
  if (row.agentType !== 'claude') {
    return row
  }
  const contextWindow = state.claudeContextWindowByPaneKey.get(row.paneKey)
  return contextWindow ? { ...row, claudeContextWindow: contextWindow } : row
}
