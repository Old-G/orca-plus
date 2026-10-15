import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PulseInboxItem } from '../../../../../shared/pulse-types'

type StoreState = {
  tabsByWorktree: Record<string, unknown[]>
  activeView: string
  settings: { hqChatsView?: boolean }
}

function storeState(activeView = 'terminal', settings: StoreState['settings'] = {}): StoreState {
  return { tabsByWorktree: {}, activeView, settings }
}

const mocks = vi.hoisted(() => ({
  launchClaudeHandoffOffer: vi.fn(async () => {}),
  switchClaudeAccountTo: vi.fn(async () => {}),
  activateAndRevealWorkspace: vi.fn(() => ({})),
  activateStructuredAgentSessionTab: vi.fn(() => true),
  activateTabAndFocusPane: vi.fn(),
  dismiss: vi.fn(async () => {}),
  markRead: vi.fn(async () => {}),
  markDone: vi.fn(async () => {}),
  continueOnSubscription: vi.fn(
    async (): Promise<{ ok: true } | { ok: false; reason: string }> => ({ ok: true })
  ),
  toastError: vi.fn(),
  openHqScreen: vi.fn(),
  openHqChat: vi.fn(),
  state: storeState()
}))

vi.mock('sonner', () => ({ toast: { error: mocks.toastError } }))

vi.mock('@/app-shell/use-claude-handoff-offers', () => ({
  launchClaudeHandoffOffer: mocks.launchClaudeHandoffOffer
}))
vi.mock('@/app-shell/use-claude-limit-guard', () => ({
  switchClaudeAccountTo: mocks.switchClaudeAccountTo
}))
vi.mock('@/lib/worktree-activation', () => ({
  activateAndRevealWorkspace: mocks.activateAndRevealWorkspace
}))
vi.mock('@/lib/agent-session/structured-agent-session-tab-activation', () => ({
  activateStructuredAgentSessionTab: mocks.activateStructuredAgentSessionTab
}))
vi.mock('@/lib/activate-tab-and-focus-pane', () => ({
  activateTabAndFocusPane: mocks.activateTabAndFocusPane
}))
vi.mock('@/store', () => ({ useAppStore: { getState: () => mocks.state } }))
vi.mock('../hq/hq-view', () => ({ openHqScreen: mocks.openHqScreen }))
vi.mock('../hq/hq-chat-actions', () => ({ openHqChat: mocks.openHqChat }))

import { runPulseBellAction } from './pulse-bell-actions'

function bellItem(kind: string, refId: string | null): PulseInboxItem {
  return {
    id: 'item-1',
    kind,
    title: 't',
    body: null,
    urgency: 'normal',
    refKind: null,
    refId,
    actions: [],
    dedupeKey: null,
    createdAt: 1,
    readAt: null,
    doneAt: null,
    doneAction: null
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.state = storeState()
  vi.stubGlobal('window', {
    api: {
      claudeHandoff: { dismiss: mocks.dismiss },
      claudeLimitGuard: { continueOnSubscription: mocks.continueOnSubscription },
      pulseBell: { markRead: mocks.markRead, markDone: mocks.markDone }
    }
  })
})

describe('runPulseBellAction', () => {
  it('opens the morning briefing on HQ’s Today tab and closes the item', async () => {
    await runPulseBellAction(bellItem('hq-briefing', null), 'open')
    expect(mocks.openHqScreen).toHaveBeenCalledWith('today')
    expect(mocks.markDone).toHaveBeenCalledWith('item-1', 'open')
  })

  it('opens the deferred sessions on HQ’s Agents tab', async () => {
    await runPulseBellAction(bellItem('hq-deferred', null), 'open')
    expect(mocks.openHqScreen).toHaveBeenCalledWith('agents')
  })

  it('launches or dismisses a handoff through its offer, which closes the item itself', async () => {
    await runPulseBellAction(bellItem('handoff', 'offer-1'), 'launch')
    expect(mocks.launchClaudeHandoffOffer).toHaveBeenCalledWith('offer-1')
    await runPulseBellAction(bellItem('handoff', 'offer-1'), 'dismiss')
    expect(mocks.dismiss).toHaveBeenCalledWith('offer-1')
    expect(mocks.markDone).not.toHaveBeenCalled()
  })

  it('opens a waiting agent and only marks the item read', async () => {
    const ref = JSON.stringify({ paneKey: 'tab-1:leaf-1', tabId: 'tab-1', worktreeId: 'wt-1' })
    await runPulseBellAction(bellItem('agent-waiting', ref), 'open')
    expect(mocks.activateAndRevealWorkspace).toHaveBeenCalledWith('wt-1', {
      revealInSidebar: false
    })
    expect(mocks.activateStructuredAgentSessionTab).toHaveBeenCalledWith({
      worktreeId: 'wt-1',
      tabId: 'tab-1'
    })
    expect(mocks.markRead).toHaveBeenCalledWith(['item-1'])
    expect(mocks.markDone).not.toHaveBeenCalled()
  })

  it('opens the agent that finished and closes its item', async () => {
    const ref = JSON.stringify({
      paneKey: 'structured-agent-session-claude_ab:leaf-1',
      tabId: 'structured-agent-session-claude_ab',
      worktreeId: 'wt-2'
    })
    await runPulseBellAction(bellItem('agent-finished', ref), 'open')
    expect(mocks.activateStructuredAgentSessionTab).toHaveBeenCalledWith({
      worktreeId: 'wt-2',
      tabId: 'structured-agent-session-claude_ab'
    })
    expect(mocks.markDone).toHaveBeenCalledWith('item-1', 'open')
  })

  it('opens a finished agent inside HQ when HQ is on screen, without leaving it', async () => {
    mocks.state = storeState('hq')
    const ref = JSON.stringify({
      paneKey: 'structured-agent-session-claude_ab:leaf-1',
      tabId: 'structured-agent-session-claude_ab',
      worktreeId: 'wt-2'
    })
    await runPulseBellAction(bellItem('agent-finished', ref), 'open')
    expect(mocks.openHqChat).toHaveBeenCalledWith('wt-2\u0000structured-agent-session-claude_ab')
    expect(mocks.activateAndRevealWorkspace).not.toHaveBeenCalled()
    expect(mocks.markDone).toHaveBeenCalledWith('item-1', 'open')
  })

  it('leaves HQ for the project when the old HQ view is on', async () => {
    mocks.state = storeState('hq', { hqChatsView: false })
    const ref = JSON.stringify({ paneKey: 'tab-9:leaf-1', tabId: 'tab-9', worktreeId: 'wt-2' })
    await runPulseBellAction(bellItem('agent-finished', ref), 'open')
    expect(mocks.openHqChat).not.toHaveBeenCalled()
    expect(mocks.activateAndRevealWorkspace).toHaveBeenCalled()
  })

  it('switches the Claude account for a limit card, then closes it with the pressed button', async () => {
    await runPulseBellAction(bellItem('claude-limit', 'acc-b'), 'switch')
    expect(mocks.switchClaudeAccountTo).toHaveBeenCalledWith('acc-b')
    expect(mocks.markDone).toHaveBeenCalledWith('item-1', 'switch')
  })

  it('continues a limit-stopped chat on the picked subscription, then closes its item', async () => {
    const ref = JSON.stringify({ paneKey: 'p', tabId: 't', worktreeId: 'wt', sessionId: 'chat-1' })
    await runPulseBellAction(bellItem('claude-chat-limit', ref), 'continue-on:work')
    expect(mocks.continueOnSubscription).toHaveBeenCalledWith({
      sessionId: 'chat-1',
      subscriptionId: 'work'
    })
    expect(mocks.markDone).toHaveBeenCalledWith('item-1', 'continue-on:work')
  })

  it('keeps a chat-limit item open and says why when the move is refused', async () => {
    mocks.continueOnSubscription.mockResolvedValueOnce({ ok: false, reason: 'busy' })
    const ref = JSON.stringify({ paneKey: 'p', tabId: 't', worktreeId: 'wt', sessionId: 'chat-1' })
    await runPulseBellAction(bellItem('claude-chat-limit', ref), 'continue-on:work')
    expect(mocks.toastError).toHaveBeenCalledWith(expect.any(String), { description: 'busy' })
    expect(mocks.markDone).not.toHaveBeenCalled()
  })

  it('only closes an item of an unknown kind', async () => {
    await runPulseBellAction(bellItem('review', null), 'done')
    expect(mocks.markDone).toHaveBeenCalledWith('item-1', 'done')
    expect(mocks.launchClaudeHandoffOffer).not.toHaveBeenCalled()
    expect(mocks.switchClaudeAccountTo).not.toHaveBeenCalled()
  })
})
