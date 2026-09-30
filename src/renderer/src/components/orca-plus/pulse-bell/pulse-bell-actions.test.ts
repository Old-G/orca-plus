import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PulseInboxItem } from '../../../../../shared/pulse-types'

const mocks = vi.hoisted(() => ({
  launchClaudeHandoffOffer: vi.fn(async () => {}),
  switchClaudeAccountTo: vi.fn(async () => {}),
  activateAndRevealWorkspace: vi.fn(() => ({})),
  activateStructuredAgentSessionTab: vi.fn(() => true),
  activateTabAndFocusPane: vi.fn(),
  dismiss: vi.fn(async () => {}),
  markRead: vi.fn(async () => {}),
  markDone: vi.fn(async () => {})
}))

vi.mock('@/app-shell/use-claude-handoff-offers', () => ({
  launchClaudeHandoffOffer: mocks.launchClaudeHandoffOffer
}))
vi.mock('@/app-shell/use-claude-limit-guard', () => ({
  switchClaudeAccountTo: mocks.switchClaudeAccountTo
}))
vi.mock('@/lib/worktree-activation', () => ({
  activateAndRevealWorkspace: mocks.activateAndRevealWorkspace
}))
vi.mock('@/lib/structured-agent-session-tab-activation', () => ({
  activateStructuredAgentSessionTab: mocks.activateStructuredAgentSessionTab
}))
vi.mock('@/lib/activate-tab-and-focus-pane', () => ({
  activateTabAndFocusPane: mocks.activateTabAndFocusPane
}))
vi.mock('@/store', () => ({ useAppStore: { getState: () => ({ tabsByWorktree: {} }) } }))

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
  vi.stubGlobal('window', {
    api: {
      claudeHandoff: { dismiss: mocks.dismiss },
      pulseBell: { markRead: mocks.markRead, markDone: mocks.markDone }
    }
  })
})

describe('runPulseBellAction', () => {
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

  it('switches the Claude account for a limit card, then closes it with the pressed button', async () => {
    await runPulseBellAction(bellItem('claude-limit', 'acc-b'), 'switch')
    expect(mocks.switchClaudeAccountTo).toHaveBeenCalledWith('acc-b')
    expect(mocks.markDone).toHaveBeenCalledWith('item-1', 'switch')
  })

  it('only closes an item of an unknown kind', async () => {
    await runPulseBellAction(bellItem('review', null), 'done')
    expect(mocks.markDone).toHaveBeenCalledWith('item-1', 'done')
    expect(mocks.launchClaudeHandoffOffer).not.toHaveBeenCalled()
    expect(mocks.switchClaudeAccountTo).not.toHaveBeenCalled()
  })
})
