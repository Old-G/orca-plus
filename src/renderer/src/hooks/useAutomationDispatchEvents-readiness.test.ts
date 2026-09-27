import type * as ReactModule from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockRendererReady = vi.fn()
const state = { workspaceSessionReady: false, startupWorktreeRefreshCompleted: false }
let storeListener: ((s: typeof state) => void) | null = null
const mockStoreUnsubscribe = vi.fn(() => {
  storeListener = null
})

vi.mock('@/store', () => ({
  useAppStore: {
    getState: () => state,
    subscribe: (listener: (s: typeof state) => void) => {
      storeListener = listener
      return mockStoreUnsubscribe
    }
  }
}))

vi.mock('./automation-dispatch-handler', () => ({
  handleAutomationDispatchRequest: vi.fn()
}))

async function register(): Promise<() => void> {
  let cleanup: (() => void) | undefined
  vi.doMock('react', async () => {
    const actual = await vi.importActual<typeof ReactModule>('react')
    return {
      ...actual,
      useEffect: (effect: () => void | (() => void)) => {
        const result = effect()
        cleanup = typeof result === 'function' ? result : undefined
      }
    }
  })
  const { useAutomationDispatchEvents: registerAutomationDispatchEvents } =
    await import('./useAutomationDispatchEvents')
  registerAutomationDispatchEvents()
  return () => cleanup?.()
}

function hydrate(): void {
  state.workspaceSessionReady = true
  storeListener?.(state)
  state.startupWorktreeRefreshCompleted = true
  storeListener?.(state)
}

describe('useAutomationDispatchEvents renderer readiness', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    state.workspaceSessionReady = false
    state.startupWorktreeRefreshCompleted = false
    storeListener = null
    vi.stubGlobal('window', {
      api: {
        automations: {
          onDispatchRequested: vi.fn(() => () => {}),
          rendererReady: mockRendererReady
        }
      }
    })
  })

  it('reports ready only after the workspace session hydrates, and once', async () => {
    await register()
    expect(mockRendererReady).not.toHaveBeenCalled()

    hydrate()
    expect(mockRendererReady).toHaveBeenCalledTimes(1)
    expect(mockStoreUnsubscribe).toHaveBeenCalled()

    expect(storeListener).toBeNull()
  })

  it('waits for the startup worktree refresh, not just the session', async () => {
    await register()
    state.workspaceSessionReady = true
    storeListener?.(state)
    // A project with no open tabs has no worktree rows yet, so an `existing`-workspace run
    // dispatched now would be refused as "The target workspace is no longer available."
    expect(mockRendererReady).not.toHaveBeenCalled()

    state.startupWorktreeRefreshCompleted = true
    storeListener?.(state)
    expect(mockRendererReady).toHaveBeenCalledTimes(1)
  })

  it('reports ready immediately when the session is already hydrated', async () => {
    state.workspaceSessionReady = true
    state.startupWorktreeRefreshCompleted = true
    await register()

    expect(mockRendererReady).toHaveBeenCalledTimes(1)
    expect(storeListener).toBeNull()
  })

  it('stops waiting when unmounted before hydration', async () => {
    const cleanup = await register()
    cleanup()

    expect(mockStoreUnsubscribe).toHaveBeenCalled()
    expect(mockRendererReady).not.toHaveBeenCalled()
  })
})
