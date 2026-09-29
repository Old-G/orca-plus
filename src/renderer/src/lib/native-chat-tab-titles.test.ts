import { describe, expect, it, vi } from 'vitest'
import type { AiVaultSessionTitle } from '../../../shared/ai-vault-session-title'
import type { Tab } from '../../../shared/tab-types'
import { resolveUnifiedTabLabel } from '../../../shared/tab-title-resolution'
import { patchAgentSessionTabAiVaultTitle } from '@/store/terminals/agent-session-tab-ai-vault-title'
import type { AppState } from '@/store/types'
import { resolveAgentSessionTabTitle } from '@/components/tab-bar/tab-bar-item-model'
import { collectAiVaultTitleRequests } from './ai-vault-tab-title-requests'
import { startAiVaultTabTitleSync } from './ai-vault-tab-title-sync'
import { aiVaultTitleSyncInputsChanged } from './ai-vault-tab-title-sync-inputs'
import { agentSessionTitleOwnersEqual, collectAiVaultTitleOwners } from './ai-vault-title-owners'

const WORKTREE = 'repo-1::/work/app'
const PANE_KEY = 'chat-tab:structured-leaf'

function chatTab(overrides: Partial<Tab> = {}): Tab {
  return {
    id: 'chat-tab',
    entityId: 'claude_orca_session',
    groupId: 'group-1',
    worktreeId: WORKTREE,
    contentType: 'agent-session',
    label: 'Claude Chat',
    customLabel: null,
    color: null,
    sortOrder: 0,
    createdAt: 1,
    agentSessionAgent: 'claude',
    ...overrides
  }
}

function makeStore(tab: Tab) {
  const listeners = new Set<(state: AppState, previous: AppState) => void>()
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the fixture supplies only the tab, status and worktree fields the title sync reads.
  let state = {
    activeWorktreeId: WORKTREE,
    activeWorkspaceExecutionHostId: 'local',
    agentStatusByPaneKey: {
      [PANE_KEY]: {
        state: 'done',
        prompt: '',
        updatedAt: 1,
        stateStartedAt: 1,
        agentType: 'claude',
        paneKey: PANE_KEY,
        tabId: tab.id,
        worktreeId: WORKTREE,
        providerSession: { key: 'session_id', id: 'claude-provider-session' },
        stateHistory: []
      }
    },
    retainedAgentsByPaneKey: {},
    sleepingAgentSessionsByPaneKey: {},
    tabsByWorktree: {},
    unifiedTabsByWorktree: { [WORKTREE]: [tab] },
    terminalLayoutsByTabId: {},
    worktreesByRepo: {},
    detectedWorktreesByRepo: {},
    folderWorkspaces: [],
    getKnownWorktreeById: () => ({ path: '/work/app' }),
    setAiVaultTabTitle: (tabId: string, aiVaultTitle: AiVaultSessionTitle | null) => {
      const patch = patchAgentSessionTabAiVaultTitle(
        state.unifiedTabsByWorktree,
        tabId,
        aiVaultTitle
      )
      if (!patch) {
        return
      }
      const previous = state
      state = { ...state, unifiedTabsByWorktree: patch }
      for (const listener of listeners) {
        listener(state, previous)
      }
    }
  } as unknown as AppState
  return {
    getState: () => state,
    subscribe: (listener: (next: AppState, previous: AppState) => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }
  }
}

describe('native chat tab titles', () => {
  it('treats a native-chat tab as a title owner and requests its Claude session title', () => {
    const store = makeStore(chatTab())
    expect(collectAiVaultTitleOwners(store.getState()).get('chat-tab')?.worktreeId).toBe(WORKTREE)
    expect(collectAiVaultTitleRequests(store.getState())).toEqual([
      expect.objectContaining({
        agent: 'claude',
        tabId: 'chat-tab',
        worktreeId: WORKTREE,
        providerSession: expect.objectContaining({ id: 'claude-provider-session' })
      })
    ])
  })

  it('writes the resolved title onto the native-chat tab and the tab label shows it', async () => {
    const store = makeStore(chatTab())
    const resolveSessionTitles = vi.fn(async () => ({
      titles: [
        {
          agent: 'claude' as const,
          sessionId: 'claude-provider-session',
          title: 'EU-retention-manual ClickUp task'
        }
      ]
    }))
    const stop = startAiVaultTabTitleSync({
      getState: store.getState,
      subscribe: store.subscribe,
      resolveSessionTitles,
      scheduleReconcile: (callback) => {
        callback()
        return () => {}
      },
      setTimer: () => 0,
      clearTimer: () => {}
    })
    await vi.waitFor(() => {
      const tab = store.getState().unifiedTabsByWorktree[WORKTREE][0]
      expect(tab.aiVaultTitle?.title).toBe('EU-retention-manual ClickUp task')
    })
    stop()
    // Pathless request: main finds the transcript by session id.
    expect(resolveSessionTitles).toHaveBeenCalledWith({
      executionHostScope: 'local',
      requests: [{ agent: 'claude', sessionId: 'claude-provider-session' }]
    })
    const tab = store.getState().unifiedTabsByWorktree[WORKTREE][0]
    expect(resolveUnifiedTabLabel(tab, false, tab.label)).toBe('EU-retention-manual ClickUp task')
  })

  it('the chat tab shows Claude’s title, and upstream’s saved name only replaces "Claude Chat"', () => {
    const tab = chatTab()
    const titled = {
      ...tab,
      aiVaultTitle: {
        agent: 'claude' as const,
        sessionId: 'claude-provider-session',
        title: 'Fix cart'
      }
    }
    expect(resolveAgentSessionTabTitle(titled, 'first message name', false)).toBe('Fix cart')
    expect(resolveAgentSessionTabTitle(tab, 'first message name', false)).toBe('first message name')
    expect(resolveAgentSessionTabTitle(tab, null, false)).toBe(tab.label)
  })

  it('keeps a manual rename above Claude’s title', () => {
    const tab = chatTab({
      customLabel: 'Claude Chat ресерч',
      aiVaultTitle: { agent: 'claude', sessionId: 's', title: 'Generated name' }
    })
    expect(resolveUnifiedTabLabel(tab, false, tab.label)).toBe('Claude Chat ресерч')
  })

  it('patches only agent-session tabs and reports no change for the same title', () => {
    const title = { agent: 'claude' as const, sessionId: 's', title: 'Name' }
    const terminal = chatTab({ id: 'term', contentType: 'terminal' })
    const tabs = { [WORKTREE]: [terminal, chatTab()] }
    expect(patchAgentSessionTabAiVaultTitle(tabs, 'term', title)).toBeNull()
    const patched = patchAgentSessionTabAiVaultTitle(tabs, 'chat-tab', title)
    expect(patched?.[WORKTREE][1].aiVaultTitle).toEqual(title)
    expect(patched?.[WORKTREE][0]).toBe(terminal)
    if (!patched) {
      throw new Error('expected the chat tab to be patched')
    }
    expect(patchAgentSessionTabAiVaultTitle(patched, 'chat-tab', { ...title })).toBeNull()
  })

  it('wakes the sync when a native-chat tab appears or its title changes', () => {
    const before = makeStore(chatTab()).getState()
    const withTitle = {
      ...before,
      unifiedTabsByWorktree: {
        [WORKTREE]: [chatTab({ aiVaultTitle: { agent: 'claude', sessionId: 's', title: 'Name' } })]
      }
    }
    expect(agentSessionTitleOwnersEqual(before, { ...before })).toBe(true)
    expect(agentSessionTitleOwnersEqual(withTitle, before)).toBe(false)
    expect(aiVaultTitleSyncInputsChanged(withTitle, before)).toBe(true)
    const noChat = { ...before, unifiedTabsByWorktree: { [WORKTREE]: [] } }
    expect(aiVaultTitleSyncInputsChanged(before, noChat)).toBe(true)
  })
})
