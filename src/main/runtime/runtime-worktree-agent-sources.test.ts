import { describe, expect, it } from 'vitest'
import { collectRuntimeWorktreeAgentSources } from './runtime-worktree-agent-sources'
import { attachRuntimeWorktreeAgentRows } from './runtime-worktree-agent-rows'
import type { AgentStatusIpcPayload } from '../../shared/agent-status-types'
import type { RuntimeWorktreePsSummary } from '../../shared/runtime-types'

const paneKey = 'worktree:tab:0'
const now = Date.now()
const hookRow: AgentStatusIpcPayload = {
  paneKey,
  tabId: 'tab',
  terminalHandle: 'term_row',
  worktreeId: 'worktree',
  connectionId: null,
  state: 'working',
  prompt: 'implement',
  agentType: 'codex',
  stateStartedAt: now,
  receivedAt: now
}
const connected = {
  hookSnapshots: [hookRow],
  mirroredWorktreeIdByTabId: new Map<string, string>(),
  connectedPtyEvidence: {
    tabIds: new Set(['tab']),
    paneKeys: new Set([paneKey]),
    ptyIdByTerminalHandle: new Map([['term_row', 'pty']])
  }
}

describe('worktree agent source admission', () => {
  it('carries the pane context window through to the worktree ps row', () => {
    const contextWindow = { usedPercentage: 72, windowTokens: 1_000_000, observedAt: now }
    const sources = collectRuntimeWorktreeAgentSources({
      ...connected,
      hookSnapshots: [{ ...hookRow, agentType: 'claude', claudeContextWindow: contextWindow }]
    })
    expect(sources.get(paneKey)?.contextWindow).toEqual(contextWindow)

    const summary: Pick<RuntimeWorktreePsSummary, 'worktreeId' | 'agents'> = {
      worktreeId: 'worktree',
      agents: []
    }
    const summaryMap = new Map([
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the row builder reads only worktreeId/agents/status fields it writes itself.
      ['worktree', summary as RuntimeWorktreePsSummary]
    ])
    attachRuntimeWorktreeAgentRows({
      summaries: summaryMap,
      terminalTitleEvidenceByWorktreeId: new Map(),
      rowSources: sources,
      orchestrationByPaneKey: null,
      getSummary: (id) => summaryMap.get(id) ?? null
    })
    expect(summary.agents).toEqual([expect.objectContaining({ paneKey, contextWindow })])
  })
})
