// @vitest-environment happy-dom

import { cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PulseInboxItem } from '../../../../../shared/pulse-types'

type StoreView = {
  activeView: string
  activeWorktreeId: string | null
  activeTabId: string | null
  activeGroupIdByWorktree: Record<string, string>
  groupsByWorktree: Record<string, { id: string; activeTabId: string | null }[]>
}

const mocks = vi.hoisted(() => {
  const items: PulseInboxItem[] = []
  const state: StoreView = {
    activeView: 'terminal',
    activeWorktreeId: null,
    activeTabId: null,
    activeGroupIdByWorktree: {},
    groupsByWorktree: {}
  }
  return {
    items,
    info: vi.fn(),
    custom: vi.fn(),
    dismiss: vi.fn(),
    run: vi.fn(async () => {}),
    state,
    toFeed: false
  }
})

vi.mock('sonner', () => ({
  toast: { info: mocks.info, custom: mocks.custom, dismiss: mocks.dismiss }
}))
vi.mock('./use-pulse-bell-inbox', () => ({ usePulseBellInbox: () => mocks.items }))
vi.mock('./pulse-bell-actions', () => ({ runPulseBellAction: mocks.run }))
vi.mock('../slack-requests/use-hq-requests-from-phone', () => ({
  useHqRequestsFromPhone: () => undefined
}))
vi.mock('@/store', () => ({ useAppStore: { getState: () => mocks.state } }))
vi.mock('../hq-plus/hq-plus-popups', () => ({ useHqPopupsGoToFeed: () => mocks.toFeed }))
vi.mock('@/i18n/i18n', () => ({ translate: (_key: string, fallback: string) => fallback }))

import { setShownHqChatTab } from '../hq/hq-chat-open'
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
    mocks.toFeed = false
    mocks.info.mockReset()
    mocks.custom.mockReset()
    mocks.dismiss.mockReset()
    mocks.run.mockClear()
    setShownHqChatTab(null)
    Object.assign(mocks.state, {
      activeView: 'terminal',
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

  it('pops nothing while HQ+ takes the events, and nothing old once popups are back', () => {
    mocks.toFeed = true
    const { rerender } = renderHook(() => usePulseBellToasts())
    mocks.items = [finished('new', 'tab-2')]
    rerender()
    expect(mocks.info).not.toHaveBeenCalled()

    mocks.toFeed = false
    rerender()
    expect(mocks.info).not.toHaveBeenCalled()
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

  it('stays quiet when HQ shows that chat', () => {
    mocks.state.activeView = 'hq'
    setShownHqChatTab({ worktreeId: 'wt-1', tabId: 'tab-1' })
    const { rerender } = renderHook(() => usePulseBellToasts())
    mocks.items = [finished('new'), finished('other', 'tab-2')]
    rerender()

    expect(mocks.info).toHaveBeenCalledTimes(1)
    expect(mocks.info.mock.calls[0]?.[1]).toMatchObject({ id: 'pulse-bell-toast-other' })
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

  it('pops a held outgoing call, even one held at launch, until it is decided', () => {
    const held: PulseInboxItem = {
      ...finished('draft-item'),
      kind: 'outgoing-approval',
      title: 'Approve an outgoing action',
      urgency: 'urgent',
      refKind: 'draft',
      refId: 'draft-1'
    }
    mocks.items = [held]
    const { rerender } = renderHook(() => usePulseBellToasts())

    expect(mocks.custom).toHaveBeenCalledTimes(1)
    expect(mocks.custom.mock.calls[0]?.[1]).toMatchObject({
      id: 'outgoing-approval-toast-draft-item',
      duration: Number.POSITIVE_INFINITY
    })
    expect(mocks.info).not.toHaveBeenCalled()

    rerender()
    expect(mocks.custom).toHaveBeenCalledTimes(1)

    mocks.items = []
    rerender()
    expect(mocks.dismiss).toHaveBeenCalledWith('outgoing-approval-toast-draft-item')
  })
})
