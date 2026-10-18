import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AutomationDispatchResult } from '../../../shared/automations-types'

const store = vi.hoisted(() => {
  const listeners = new Set<() => void>()
  const state: Record<string, unknown> = {}
  return {
    state,
    listeners,
    emit: () => listeners.forEach((listener) => listener())
  }
})

vi.mock('@/store', () => ({
  useAppStore: {
    getState: () => store.state,
    subscribe: (listener: () => void) => {
      store.listeners.add(listener)
      return () => store.listeners.delete(listener)
    }
  }
}))
vi.mock('./automation-dispatch-workspace', () => ({
  resolveAutomationDispatchWorkspace: () => ({
    repo: { id: 'repo-1' },
    context: { workspaceId: 'wt-1', workspaceDisplayName: 'HQ', precheckResult: null }
  }),
  prepareAutomationDispatchWorkspace: async () => ({ id: 'wt-1', displayName: 'HQ' })
}))
const launchAgentInNewTab = vi.fn((_args: unknown) => ({}))
vi.mock('@/lib/launch-agent-in-new-tab', () => ({
  launchAgentInNewTab: (args: unknown) => launchAgentInNewTab(args)
}))
const launchAgentBackgroundSession = vi.fn(async (_args: unknown) => null)
vi.mock('@/lib/launch-agent-background-session', () => ({
  launchAgentBackgroundSession: (args: unknown) => launchAgentBackgroundSession(args)
}))
vi.mock('@/components/orca-plus/hq/hq-today-actions', () => ({
  agentPaneKeys: () => new Set<string>(),
  waitForNewAgentPane: async () => 'chat-tab:11111111-2222-4333-a444-555555555555'
}))

const markDispatchResult = vi.fn<(result: AutomationDispatchResult) => Promise<void>>()
const setTabCustomLabel = vi.fn()

function dispatch(): Promise<void> {
  return import('./automation-dispatch-handler').then(({ handleAutomationDispatchRequest }) =>
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the handler reads only these fields; the workspace module is mocked.
    handleAutomationDispatchRequest({
      automation: {
        id: 'auto-1',
        agentId: 'claude',
        prompt: 'Недельный разбор',
        reuseSession: false
      },
      run: { id: 'run-1', title: 'Неделя: что улучшить run 2', workspaceId: 'wt-1' },
      dispatchToken: 'token'
    } as never)
  )
}

describe('automation dispatch in a native chat', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    store.listeners.clear()
    Object.assign(store.state, {
      settings: { experimentalNativeChat: true },
      agentStatusByPaneKey: {},
      activeWorktreeId: null,
      setTabCustomLabel
    })
    markDispatchResult.mockResolvedValue(undefined)
    vi.stubGlobal('window', { api: { automations: { markDispatchResult } } })
  })

  it('opens the run as a named chat and completes it on the chat’s done', async () => {
    await dispatch()

    expect(launchAgentBackgroundSession).not.toHaveBeenCalled()
    expect(launchAgentInNewTab).toHaveBeenCalledWith(
      expect.objectContaining({ agent: 'claude', worktreeId: 'wt-1', prompt: 'Недельный разбор' })
    )
    expect(setTabCustomLabel).toHaveBeenCalledWith('chat-tab', 'Неделя: что улучшить run 2', {
      recordInteraction: false
    })
    expect(markDispatchResult).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'dispatched', terminalSessionId: 'chat-tab' })
    )
    expect(markDispatchResult.mock.calls[0]?.[0]).not.toHaveProperty('terminalPaneKey')

    const at = Date.now() + 1
    const entry = (state: string) => ({
      state,
      updatedAt: at,
      stateHistory: [],
      lastAssistantMessage: state === 'done' ? 'Отчёт готов' : undefined
    })
    // A done before the turn started working is not the run's result.
    store.state.agentStatusByPaneKey = {
      'chat-tab:11111111-2222-4333-a444-555555555555': entry('done')
    }
    store.emit()
    expect(markDispatchResult).toHaveBeenCalledTimes(1)

    store.state.agentStatusByPaneKey = {
      'chat-tab:11111111-2222-4333-a444-555555555555': entry('working')
    }
    store.emit()
    store.state.agentStatusByPaneKey = {
      'chat-tab:11111111-2222-4333-a444-555555555555': entry('done')
    }
    store.emit()
    await vi.waitFor(() =>
      expect(markDispatchResult).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: 'completed', error: null })
      )
    )
  })

  it('keeps the terminal when the Chat UI switch is off', async () => {
    store.state.settings = { experimentalNativeChat: false }

    await dispatch()

    expect(launchAgentInNewTab).not.toHaveBeenCalled()
    expect(launchAgentBackgroundSession).toHaveBeenCalledOnce()
  })
})
