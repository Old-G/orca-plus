// @vitest-environment happy-dom

import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import type { DashboardCard, DashboardWorkspace } from '../../../../../shared/dashboard-snapshot'
import type { Tab } from '../../../../../shared/tab-types'
import { buildHqChatList, hqChatKey, type HqChatItem } from './hq-chat-list'
import type * as HqChatActions from './hq-chat-actions'

type ChatProps = {
  tabId: string
  groupId?: string
  sessionId: string
  isVisible: boolean
  isFocusedGroup: boolean
  target: unknown
}

type PendingPrompt = {
  kind: 'approval' | 'question'
  text: string
  detail: string | null
  answers: { id: string; label: string; response: unknown }[]
} | null

const mocks = vi.hoisted(() => {
  const items: HqChatItem[] = []
  const chatProps: ChatProps[] = []
  const previews: string[] = []
  const prompt: { current: PendingPrompt } = { current: null }
  return {
    items,
    chatProps,
    previews,
    prompt,
    respond: vi.fn(async () => true),
    openInProject: vi.fn(),
    acknowledge: vi.fn(),
    acknowledgeMany: vi.fn(),
    closeFinishToast: vi.fn(async () => {})
  }
})

vi.mock('@/hooks/use-now', () => ({ useNow: () => 100_000 }))
vi.mock('@/store', () => {
  const state = () => ({ activeView: 'hq', setActiveView: vi.fn(), setSidebarOpen: vi.fn() })
  const useAppStore = (selector: (s: object) => unknown) => selector(state())
  useAppStore.getState = state
  return { useAppStore }
})
vi.mock('@/lib/web-client-location', () => ({ isWebClientLocation: () => false }))
vi.mock('./HqPinnedPane', () => ({
  HqPinnedPane: ({ id }: { id: string }) => <div data-testid="pinned-pane">{id}</div>
}))
vi.mock('./use-hq-spaces', () => ({
  useHqSpaces: () => ({
    spaces: [],
    active: null,
    setActive: () => {},
    shows: () => true,
    stripeOf: () => null
  })
}))
vi.mock('./HqContextPanel', () => ({ HqContextPanel: () => <aside>context panel</aside> }))
vi.mock('./use-hq-pinned-notes', () => ({
  useHqPinnedNotes: () => ({ waiting: { text: '2 on you', tone: 'needs' } }),
  markHqPinnedSeen: () => {}
}))
vi.mock('./use-hq-pending-prompt', () => ({
  useHqPendingPrompt: () => ({ prompt: mocks.prompt.current, respond: mocks.respond })
}))
vi.mock('@/lib/shortcut-platform', () => ({ getShortcutPlatform: () => 'darwin' }))
vi.mock('@/runtime/structured-agent-session-owner', () => ({
  structuredAgentSessionOwnerForTab: (_state: unknown, tab: Tab) => tab.executionHostId ?? 'local',
  structuredAgentSessionTargetForHost: (owner: string) =>
    owner === 'local' ? { kind: 'local' } : null
}))
vi.mock('@/runtime/structured-conversation-name', () => ({
  useStructuredChatTabConversationName: () => null
}))
vi.mock('./use-hq-chat-list', () => ({
  useHqChatList: () => ({ items: mocks.items, cards: [] }),
  useHqProjectColor: () => () => '#22c55e'
}))
vi.mock('./hq-chat-actions', async (importOriginal) => ({
  ...(await importOriginal<typeof HqChatActions>()),
  openHqChatInProject: mocks.openInProject,
  acknowledgeHqChat: mocks.acknowledge,
  acknowledgeHqChats: mocks.acknowledgeMany
}))
vi.mock('../pulse-bell/PulseBellButton', () => ({
  PulseBellButton: () => <button type="button">Inbox</button>
}))
vi.mock('../pulse-bell/pulse-bell-actions', () => ({
  closeFinishedPulseBellItemsForHqChat: mocks.closeFinishToast
}))
vi.mock('../../native-chat/NativeChatView', () => ({
  default: (props: ChatProps) => {
    mocks.chatProps.push(props)
    return <div data-testid="native-chat">{props.sessionId}</div>
  }
}))
vi.mock('../../dashboard-popout/AgentTerminalPreview', () => ({
  AgentTerminalPreview: ({ ptyId }: { ptyId: string }) => {
    mocks.previews.push(ptyId)
    return <div data-testid="terminal-preview">{ptyId}</div>
  }
}))

import { rememberHqChat } from './hq-chat-open'
import { rememberHqSelection } from './hq-messenger-selection'
import { openHqScreen } from './hq-view'
import { HqMessengerScreen } from './HqMessengerScreen'

const workspace = (worktreeId: string, hostKind: DashboardWorkspace['hostKind'] = 'local') =>
  ({
    repoId: 'repo-1',
    worktreeId,
    repoName: 'orca-custom',
    worktreeName: 'custom',
    hostKind,
    executionHostId: 'local',
    workspaceKind: 'worktree'
  }) satisfies DashboardWorkspace

const chatTab = (id: string, label: string, overrides: Partial<Tab> = {}): Tab => ({
  id,
  entityId: `session-${id}`,
  groupId: 'group-1',
  worktreeId: 'wt-1',
  contentType: 'agent-session',
  agentSessionAgent: 'claude',
  label,
  customLabel: null,
  color: null,
  sortOrder: 0,
  createdAt: 1,
  ...overrides
})

const card = (overrides: Partial<DashboardCard>): DashboardCard => ({
  paneKey: 'x:l',
  ptyId: null,
  agentType: 'claude',
  bucket: 'working',
  dotState: 'working',
  task: '',
  repoId: 'repo-1',
  worktreeId: 'wt-1',
  tabId: 'x',
  leafId: 'l',
  repoName: 'orca-custom',
  worktreeName: 'custom',
  startedAt: 10,
  finishedAt: null,
  stateChangedAt: 10,
  unseen: false,
  ...overrides
})

function setItems(cards: DashboardCard[], tabs: Tab[], workspaces = [workspace('wt-1')]): void {
  mocks.items = buildHqChatList({ cards, workspaces }, tabs)
}

function renderTab(): ReturnType<typeof render> {
  return render(
    <TooltipProvider>
      <HqMessengerScreen />
    </TooltipProvider>
  )
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  mocks.chatProps = []
  mocks.previews = []
  rememberHqChat(null)
  rememberHqSelection({ kind: 'chat' })
  mocks.prompt.current = null
})

describe('HqMessengerScreen', () => {
  it('opens the chat that needs the user, live, outside any split group', () => {
    setItems(
      [
        card({
          tabId: 'ask',
          paneKey: 'ask:l',
          bucket: 'attention',
          dotState: 'waiting',
          askSummary: 'Which tenant?'
        }),
        card({ tabId: 'work', paneKey: 'work:l', stateChangedAt: 90 })
      ],
      [chatTab('ask', 'Tenant check'), chatTab('work', 'Review')]
    )
    renderTab()
    expect(screen.getByRole('region', { name: 'Needs you' })).toBeTruthy()
    expect(screen.getByText('Which tenant?')).toBeTruthy()
    expect(screen.getByTestId('native-chat').textContent).toBe('session-ask')
    const props = mocks.chatProps.at(-1)
    expect(props).toMatchObject({ tabId: 'ask', isVisible: true, isFocusedGroup: true })
    expect(props?.groupId).toBeUndefined()
  })

  it('switches chats on a click and marks the one it left read', () => {
    setItems(
      [
        card({
          tabId: 'fresh',
          paneKey: 'fresh:l',
          bucket: 'done',
          dotState: 'done',
          unseen: true,
          stateChangedAt: 90
        }),
        card({ tabId: 'work', paneKey: 'work:l' })
      ],
      [chatTab('fresh', 'Weekly sync'), chatTab('work', 'Review')]
    )
    renderTab()
    fireEvent.click(screen.getByRole('button', { name: /Weekly sync/ }))
    expect(screen.getByTestId('native-chat').textContent).toBe('session-fresh')
    // Why: opening a finished chat answers its «An agent finished» toast, as its Open would.
    expect(mocks.closeFinishToast).toHaveBeenLastCalledWith('wt-1', 'fresh')
    expect(mocks.acknowledge).toHaveBeenLastCalledWith(
      expect.objectContaining({ key: hqChatKey('wt-1', 'work') })
    )
    fireEvent.click(screen.getByRole('button', { name: /Review/ }))
    expect(mocks.acknowledge).toHaveBeenLastCalledWith(
      expect.objectContaining({ key: hqChatKey('wt-1', 'fresh') })
    )
  })

  it("keeps a recent project's read chats in view, and opens one in its project on request", () => {
    setItems([], [chatTab('new', 'Fresh chat')])
    renderTab()
    const projects = screen.getByRole('region', { name: 'Active projects' })
    expect(screen.queryByRole('button', { name: /Quiet/ })).toBeNull()
    fireEvent.click(within(projects).getByRole('button', { name: /Fresh chat/ }))
    expect(screen.getByText('No turns yet')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Open project' }))
    expect(mocks.openInProject).toHaveBeenCalledWith(
      expect.objectContaining({ key: hqChatKey('wt-1', 'new') })
    )
  })

  it("shows a terminal agent's live terminal, and says so when HQ cannot reach a chat's host", () => {
    setItems(
      [card({ tabId: 'term', paneKey: 'term:leaf', ptyId: 'pty-7', stateChangedAt: 90 })],
      [chatTab('remote', 'Remote chat', { worktreeId: 'wt-ssh', executionHostId: 'ssh:box' })],
      [workspace('wt-1'), workspace('wt-ssh', 'ssh')]
    )
    mocks.items = mocks.items.map((item) =>
      item.kind === 'chat' ? { ...item, group: 'working' } : item
    )
    renderTab()
    expect(screen.getByTestId('terminal-preview').textContent).toBe('pty-7')
    fireEvent.click(screen.getByRole('button', { name: /Remote chat/ }))
    expect(screen.getByText(/cannot reach from here/)).toBeTruthy()
    expect(screen.queryByTestId('native-chat')).toBeNull()
  })

  it('reopens the chat shown last time', () => {
    setItems(
      [card({ tabId: 'work', paneKey: 'work:l', stateChangedAt: 90 })],
      [chatTab('work', 'Review'), chatTab('old', 'Old chat')]
    )
    rememberHqChat(hqChatKey('wt-1', 'old'))
    renderTab()
    expect(screen.getByTestId('native-chat').textContent).toBe('session-old')
  })

  it('shows a pinned page on the right, and opens on one another surface asks for', () => {
    setItems([card({ tabId: 'work', paneKey: 'work:l' })], [chatTab('work', 'Review')])
    renderTab()
    expect(screen.getByText('2 on you')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Notes/ }))
    expect(screen.getByTestId('pinned-pane').textContent).toBe('waiting')
    expect(screen.queryByTestId('native-chat')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Review/ }))
    expect(screen.getByTestId('native-chat').textContent).toBe('session-work')
    act(() => openHqScreen('today'))
    expect(screen.getByTestId('pinned-pane').textContent).toBe('today')
  })

  it('closes a pinned page on a second press, back to the chat or page shown before', () => {
    setItems([card({ tabId: 'work', paneKey: 'work:l' })], [chatTab('work', 'Review')])
    renderTab()
    fireEvent.click(screen.getByRole('button', { name: /Review/ }))
    fireEvent.click(screen.getByRole('button', { name: /^Feed/ }))
    expect(screen.getByTestId('pinned-pane').textContent).toBe('feed')
    fireEvent.click(screen.getByRole('button', { name: /^Feed/ }))
    expect(screen.getByTestId('native-chat').textContent).toBe('session-work')
    fireEvent.click(screen.getByRole('button', { name: /Notes/ }))
    fireEvent.click(screen.getByRole('button', { name: /^Feed/ }))
    fireEvent.click(screen.getByRole('button', { name: /^Feed/ }))
    expect(screen.getByTestId('pinned-pane').textContent).toBe('waiting')
  })

  it('answers a waiting chat from its row, and steps to the next waiting one by key', () => {
    mocks.prompt.current = {
      kind: 'question',
      detail: null,
      text: 'Which tenant?',
      answers: [
        { id: 'a', label: 'staging-2', response: { kind: 'option', optionId: 'a' } },
        { id: 'b', label: 'demo', response: { kind: 'option', optionId: 'b' } }
      ]
    }
    setItems(
      ['one', 'two'].map((id, index) =>
        card({
          tabId: id,
          paneKey: `${id}:l`,
          bucket: 'attention',
          dotState: 'waiting',
          stateChangedAt: 50 - index
        })
      ),
      [chatTab('one', 'First ask'), chatTab('two', 'Second ask')]
    )
    renderTab()
    expect(screen.getAllByText('Which tenant?').length).toBe(2)
    fireEvent.click(screen.getAllByRole('button', { name: 'demo' })[0])
    expect(mocks.respond).toHaveBeenCalledWith({ kind: 'option', optionId: 'b' })
    expect(screen.getByTestId('native-chat').textContent).toBe('session-one')
    fireEvent.keyDown(window, { key: 'ArrowDown', metaKey: true, altKey: true })
    expect(screen.getByTestId('native-chat').textContent).toBe('session-two')
    fireEvent.keyDown(window, { key: 'ArrowDown', metaKey: true, altKey: true })
    expect(screen.getByTestId('native-chat').textContent).toBe('session-one')
  })

  it('marks every unread finish read at once', () => {
    setItems(
      ['x', 'y'].map((id) =>
        card({ tabId: id, paneKey: `${id}:l`, bucket: 'done', dotState: 'done', unseen: true })
      ),
      [chatTab('x', 'Report X'), chatTab('y', 'Report Y')]
    )
    renderTab()
    fireEvent.click(screen.getByRole('button', { name: 'Mark all read' }))
    expect(mocks.acknowledgeMany.mock.calls[0][0].map((item: HqChatItem) => item.key)).toEqual([
      hqChatKey('wt-1', 'x'),
      hqChatKey('wt-1', 'y')
    ])
  })

  it('shows what an approval would run and leads to its card, never granting it from the list', () => {
    mocks.prompt.current = { kind: 'approval', text: 'Bash', detail: 'rm -rf build', answers: [] }
    setItems(
      [
        card({ tabId: 'work', paneKey: 'work:l', stateChangedAt: 90 }),
        card({ tabId: 'gate', paneKey: 'gate:l', bucket: 'attention', dotState: 'blocked' })
      ],
      [chatTab('work', 'Review work'), chatTab('gate', 'Cleanup')]
    )
    renderTab()
    expect(screen.getByText('rm -rf build')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Allow/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Review work/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Review' }))
    expect(screen.getByTestId('native-chat').textContent).toBe('session-gate')
    expect(mocks.respond).not.toHaveBeenCalled()
  })
})
