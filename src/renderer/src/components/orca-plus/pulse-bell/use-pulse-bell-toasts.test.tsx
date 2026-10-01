// @vitest-environment happy-dom

import { cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PulseInboxItem } from '../../../../../shared/pulse-types'

type StoreView = {
  activeWorktreeId: string | null
  activeTabId: string | null
  activeGroupIdByWorktree: Record<string, string>
  groupsByWorktree: Record<string, { id: string; activeTabId: string | null }[]>
}

const mocks = vi.hoisted(() => {
  const items: PulseInboxItem[] = []
  const state: StoreView = {
    activeWorktreeId: null,
    activeTabId: null,
    activeGroupIdByWorktree: {},
    groupsByWorktree: {}
  }
  return {
    items,
    info: vi.fn(),
    dismiss: vi.fn(),
    run: vi.fn(async () => {}),
    state
  }
})

vi.mock('sonner', () => ({ toast: { info: mocks.info, dismiss: mocks.dismiss } }))
vi.mock('./use-pulse-bell-inbox', () => ({ usePulseBellInbox: () => mocks.items }))
vi.mock('./pulse-bell-actions', () => ({ runPulseBellAction: mocks.run }))
vi.mock('@/store', () => ({ useAppStore: { getState: () => mocks.state } }))
vi.mock('@/i18n/i18n', () => ({ translate: (_key: string, fallback: string) => fallback }))

import { usePulseBellToasts } from './use-pulse-bell-toasts'

function finished(id: string, tabId = 'tab-1'): PulseInboxItem {
  return {
    id,
    kind: 'agent-finished',
    title: 'An agent finished',
    body: 'Claude · shop / main — Done',
    urgency: 'normal',
    refKind: 'pane',
    refId: JSON.stringify({ paneKey: `${tabId}:leaf-1`, tabId, worktreeId: 'wt-1' }),
    actions: [],
    dedupeKey: `agent-finished:${tabId}:leaf-1`,
    createdAt: 1,
    readAt: null,
    doneAt: null,
    doneAction: null
  }
}

describe('usePulseBellToasts', () => {
  beforeEach(() => {
    mocks.items = []
    mocks.info.mockReset()
    mocks.dismiss.mockReset()
    mocks.run.mockClear()
    Object.assign(mocks.state, {
      activeWorktreeId: 'wt-other',
      activeTabId: null,
      activeGroupIdByWorktree: {},
      groupsByWorktree: {}
    })
    vi.spyOn(document, 'hasFocus').mockReturnValue(true)
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('toasts an agent that finishes after launch and opens it from the toast', () => {
    mocks.items = [finished('old')]
    const { rerender } = renderHook(() => usePulseBellToasts())
    expect(mocks.info).not.toHaveBeenCalled()

    mocks.items = [finished('old'), finished('new', 'tab-2')]
    rerender()

    expect(mocks.info).toHaveBeenCalledTimes(1)
    const [title, options] = mocks.info.mock.calls[0]!
    expect(title).toBe('An agent finished')
    expect(options).toMatchObject({
      id: 'pulse-bell-toast-new',
      description: 'Claude · shop / main — Done',
      duration: Number.POSITIVE_INFINITY
    })
    options.action.onClick()
    expect(mocks.run).toHaveBeenCalledWith(expect.objectContaining({ id: 'new' }), 'open')
  })

  it('closes the toast once the Inbox item is done', () => {
    const { rerender } = renderHook(() => usePulseBellToasts())
    mocks.items = [finished('new')]
    rerender()
    mocks.items = []
    rerender()

    expect(mocks.dismiss).toHaveBeenCalledWith('pulse-bell-toast-new')
  })

  it('stays quiet when the user is looking at that pane', () => {
    Object.assign(mocks.state, {
      activeWorktreeId: 'wt-1',
      activeGroupIdByWorktree: { 'wt-1': 'g-1' },
      groupsByWorktree: { 'wt-1': [{ id: 'g-1', activeTabId: 'tab-1' }] }
    })
    const { rerender } = renderHook(() => usePulseBellToasts())
    mocks.items = [finished('new')]
    rerender()

    expect(mocks.info).not.toHaveBeenCalled()
  })

  it('still toasts that pane while Orca+ is not in front', () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(false)
    Object.assign(mocks.state, { activeWorktreeId: 'wt-1', activeTabId: 'tab-1' })
    const { rerender } = renderHook(() => usePulseBellToasts())
    mocks.items = [finished('new')]
    rerender()

    expect(mocks.info).toHaveBeenCalledTimes(1)
  })

  it('toasts a limit-stopped chat in view with its continue button', () => {
    Object.assign(mocks.state, { activeWorktreeId: 'wt-1', activeTabId: 'tab-1' })
    const { rerender } = renderHook(() => usePulseBellToasts())
    mocks.items = [
      {
        ...finished('limit'),
        kind: 'claude-chat-limit',
        title: 'A chat stopped on its Claude limit',
        urgency: 'urgent',
        actions: [
          { id: 'continue-on:work', label: 'Continue on Work' },
          { id: 'dismiss', label: 'Not now' }
        ]
      }
    ]
    rerender()

    const [, options] = mocks.info.mock.calls[0]!
    expect(options.action.label).toBe('Continue on Work')
    options.action.onClick()
    expect(mocks.run).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'limit' }),
      'continue-on:work'
    )
  })
})
