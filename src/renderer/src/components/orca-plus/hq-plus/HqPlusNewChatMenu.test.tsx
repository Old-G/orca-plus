// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { HqPlusNewChatMenu } from './HqPlusNewChatMenu'

const h = vi.hoisted(() => ({
  launchOptions: null as null | Record<string, unknown>,
  launch: vi.fn(),
  createNewTerminalTab: vi.fn(),
  activateAndRevealWorkspaceWithOutcome: vi.fn((): unknown => ({ opened: { primaryTabId: null } })),
  openChatInShownHq: vi.fn(),
  waitForNewAgentPane: vi.fn(() => Promise.resolve(null))
}))

vi.mock('@/components/agent/launch-menu/AgentMenuItems', async () => {
  const ui = await import('@/components/ui/dropdown-menu')
  return {
    useTabAgentMenuLaunch: (options: Record<string, unknown>) => {
      h.launchOptions = options
      return h.launch
    },
    ProjectedAgentMenuItems: ({ runLaunch }: { runLaunch: (row: unknown) => unknown }) => (
      <ui.DropdownMenuItem
        onSelect={() => runLaunch({ kind: 'chat', agent: 'codex', executionHostId: 'local' })}
      >
        Codex
      </ui.DropdownMenuItem>
    )
  }
})
vi.mock('@/components/agent/launch-menu/use-new-tab-agent-menu-rows', () => ({
  useNewTabAgentMenuRows: () => ({ state: 'loading', placeholderCount: 0 })
}))
vi.mock('@/lib/agent-session/launch/inventory/useAgentDetectionTarget', () => ({
  useAgentDetectionTargetForWorktree: () => undefined
}))
vi.mock('@/components/terminal/tab-lifecycle/terminal-tab-create', () => ({
  createNewTerminalTab: h.createNewTerminalTab
}))
vi.mock('@/lib/workspace/activation/worktree-activation', () => ({
  activateAndRevealWorkspaceWithOutcome: h.activateAndRevealWorkspaceWithOutcome
}))
vi.mock('@/store', () => ({
  useAppStore: (select: (state: unknown) => unknown) =>
    select({ activeGroupIdByWorktree: { 'wt-acme': 'group-7' } })
}))
vi.mock('../hq/hq-chat-open', () => ({ openChatInShownHq: h.openChatInShownHq }))
vi.mock('../hq/hq-today-actions', () => ({
  agentPaneKeys: () => new Set(['tab-old:1']),
  waitForNewAgentPane: h.waitForNewAgentPane
}))

const onPicked = vi.fn()

function openMenu(): void {
  render(
    <HqPlusNewChatMenu worktreeId="wt-acme" onPicked={onPicked}>
      <button type="button">+ New chat</button>
    </HqPlusNewChatMenu>
  )
  fireEvent.keyDown(screen.getByRole('button', { name: '+ New chat' }), { key: 'Enter' })
}

beforeEach(() => {
  vi.stubGlobal('api', { ui: { setShortcutRecorderFocused: vi.fn() } })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
  h.launchOptions = null
})

it('offers New Terminal first, then the agents, and asks for them only while open', () => {
  render(
    <HqPlusNewChatMenu worktreeId="wt-acme">
      <button type="button">+ New chat</button>
    </HqPlusNewChatMenu>
  )
  expect(h.launchOptions).toBeNull()
  cleanup()

  openMenu()
  const items = screen.getAllByRole('menuitem').map((item) => item.textContent)
  expect(items).toEqual(['New Terminal', 'Codex'])
  expect(h.launchOptions).toMatchObject({ worktreeId: 'wt-acme', groupId: 'group-7' })
})

it('starts the picked agent in the project and opens its chat in HQ+', async () => {
  h.launch.mockImplementation(() => {
    const onFocusChat = h.launchOptions?.onFocusChat as (tabId: string) => void
    onFocusChat('tab-new')
    return true
  })
  openMenu()
  fireEvent.click(screen.getByRole('menuitem', { name: 'Codex' }))

  expect(h.launch).toHaveBeenCalledWith({ kind: 'chat', agent: 'codex', executionHostId: 'local' })
  expect(h.waitForNewAgentPane).toHaveBeenCalledWith('wt-acme', new Set(['tab-old:1']))
  expect(onPicked).toHaveBeenCalledTimes(1)
  await act(async () => {})
  expect(h.openChatInShownHq).toHaveBeenCalledWith('wt-acme', 'tab-new')
})

it('keeps the popover open when the launch is refused', () => {
  h.launch.mockReturnValue(false)
  openMenu()
  fireEvent.click(screen.getByRole('menuitem', { name: 'Codex' }))
  expect(onPicked).not.toHaveBeenCalled()
  expect(h.openChatInShownHq).not.toHaveBeenCalled()
})

it('opens New Terminal in the project in Orca', () => {
  openMenu()
  fireEvent.click(screen.getByRole('menuitem', { name: 'New Terminal' }))
  expect(h.activateAndRevealWorkspaceWithOutcome).toHaveBeenCalledWith('wt-acme')
  expect(h.createNewTerminalTab).toHaveBeenCalledWith('wt-acme', undefined, {
    onSettled: expect.any(Function)
  })
  expect(onPicked).toHaveBeenCalledTimes(1)
})

it('opens no terminal in a folder workspace Orca refuses to open', () => {
  h.activateAndRevealWorkspaceWithOutcome.mockReturnValue({
    refused: { reason: 'path-blocked', failureNotified: true }
  })
  openMenu()
  fireEvent.click(screen.getByRole('menuitem', { name: 'New Terminal' }))
  expect(h.activateAndRevealWorkspaceWithOutcome).toHaveBeenCalledWith('wt-acme')
  expect(h.createNewTerminalTab).not.toHaveBeenCalled()
})
