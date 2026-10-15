// Custom build (hq-stays): a notification clicked while HQ's messenger is in front opens its chat
// in HQ; anywhere else it still reveals the chat in its project.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  inHq: true,
  openChatInShownHq: vi.fn((_worktreeId: string, _tabId: string) => mocks.inHq),
  revealWorkspaceSurface: vi.fn(),
  setActiveTab: vi.fn(),
  activateTabAndFocusPane: vi.fn()
}))

vi.mock('@/components/orca-plus/hq/hq-chat-open', () => ({
  openChatInShownHq: mocks.openChatInShownHq
}))
vi.mock('@/lib/workspace-surface-reveal', () => ({
  revealWorkspaceSurface: mocks.revealWorkspaceSurface
}))
vi.mock('@/lib/activate-tab-and-focus-pane', () => ({
  activateTabAndFocusPane: mocks.activateTabAndFocusPane
}))
vi.mock('./host-session-tab-target', () => ({
  resolveWindowTabIdForHostTab: (_worktreeId: string, tabId: string) => tabId
}))
vi.mock('../../store', () => ({
  useAppStore: {
    getState: () => ({
      setActiveTab: mocks.setActiveTab,
      activeWorktreeId: 'wt-1',
      unifiedTabsByWorktree: { 'wt-1': [{ id: 'chat-1', contentType: 'agent-session' }] }
    }),
    subscribe: () => () => {}
  }
}))

import { registerTerminalUiRoutingIpcBridge } from './terminal-ui-routing-ipc-bridge'

type Listener = (payload: never) => void

function setup(): (name: string, payload: Record<string, unknown>) => void {
  const listeners = new Map<string, Listener>()
  const ui = new Proxy(
    {},
    {
      get: (_target, name) =>
        typeof name === 'string' && name.startsWith('on')
          ? (listener: Listener) => {
              listeners.set(name, listener)
              return () => {}
            }
          : vi.fn()
    }
  )
  vi.stubGlobal('window', { api: { ui }, dispatchEvent: vi.fn() })
  registerTerminalUiRoutingIpcBridge([])
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: each test passes the payload shape its named listener declares.
  return (name, payload) => listeners.get(name)?.(payload as never)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
  mocks.inHq = true
})

describe('notification clicks while HQ is in front', () => {
  it('opens a clicked chat notification in HQ without revealing its project', () => {
    const emit = setup()
    emit('onFocusEditorTab', { tabId: 'chat-1', worktreeId: 'wt-1', userInitiated: true })
    expect(mocks.openChatInShownHq).toHaveBeenCalledWith('wt-1', 'chat-1')
    expect(mocks.revealWorkspaceSurface).not.toHaveBeenCalled()
  })

  it('opens a clicked terminal notification in HQ without focusing the pane', () => {
    const emit = setup()
    emit('onFocusTerminal', {
      tabId: 'tab-1',
      worktreeId: 'wt-1',
      leafId: 'leaf-1',
      ackPaneKeyOnSuccess: 'tab-1:leaf-1',
      fromNotification: true
    })
    expect(mocks.openChatInShownHq).toHaveBeenCalledWith('wt-1', 'tab-1')
    expect(mocks.revealWorkspaceSurface).not.toHaveBeenCalled()
    expect(mocks.activateTabAndFocusPane).not.toHaveBeenCalled()
  })

  it('leaves CLI and runtime focus requests to the project, even in HQ', () => {
    const emit = setup()
    emit('onFocusTerminal', { tabId: 'tab-1', worktreeId: 'wt-1', ackPaneKeyOnSuccess: 'k' })
    expect(mocks.openChatInShownHq).not.toHaveBeenCalled()
    expect(mocks.revealWorkspaceSurface).toHaveBeenCalled()
  })

  it('reveals the pane in its project outside HQ', () => {
    mocks.inHq = false
    const emit = setup()
    emit('onFocusTerminal', {
      tabId: 'tab-1',
      worktreeId: 'wt-1',
      ackPaneKeyOnSuccess: 'tab-1:leaf-1',
      fromNotification: true
    })
    expect(mocks.revealWorkspaceSurface).toHaveBeenCalled()
    expect(mocks.activateTabAndFocusPane).toHaveBeenCalled()
  })
})
