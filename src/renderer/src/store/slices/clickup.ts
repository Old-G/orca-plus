import type { StateCreator } from 'zustand'
import type { AppState } from '../types'
import type {
  ClickUpConnectResult,
  ClickUpConnectionStatus
} from '../../../../shared/clickup-types'
import { getProviderRuntimeContextKey } from '@/lib/provider-runtime-context'
import {
  clickUpConnect,
  clickUpDisconnect,
  clickUpSelectWorkspace,
  clickUpStatus,
  clickUpTestConnection
} from '@/runtime/runtime-clickup-client'

export type ClickUpSlice = {
  clickUpStatus: ClickUpConnectionStatus
  clickUpStatusChecked: boolean
  clickUpStatusContextKey: string | null
  /** Bumped on connect/disconnect/workspace change so task views refetch. */
  clickUpConnectionRevision: number
  checkClickUpConnection: () => Promise<void>
  connectClickUp: (apiToken: string) => Promise<ClickUpConnectResult>
  testClickUpConnection: () => Promise<ClickUpConnectResult>
  selectClickUpWorkspace: (workspaceId: string) => Promise<void>
  disconnectClickUp: () => Promise<void>
}

const DISCONNECTED: ClickUpConnectionStatus = {
  connected: false,
  viewer: null,
  workspaces: [],
  selectedWorkspaceId: null
}

let statusReadGeneration = 0

export const createClickUpSlice: StateCreator<AppState, [], [], ClickUpSlice> = (set, get) => {
  const applyStatus = (contextKey: string, status: ClickUpConnectionStatus, bump: boolean): void =>
    set((state) => ({
      clickUpStatus: status,
      clickUpStatusChecked: true,
      clickUpStatusContextKey: contextKey,
      clickUpConnectionRevision: state.clickUpConnectionRevision + (bump ? 1 : 0)
    }))

  const refreshStatus = async (bump: boolean): Promise<void> => {
    const generation = ++statusReadGeneration
    const contextKey = getProviderRuntimeContextKey(get().settings)
    if (get().clickUpStatusContextKey !== contextKey) {
      set({ clickUpStatusChecked: false })
    }
    let status = DISCONNECTED
    try {
      status = await clickUpStatus(get().settings)
    } catch {
      // Why: an unreachable runtime reads as disconnected rather than a stale "connected".
    }
    // Why: a newer read or a runtime switch owns the state now.
    if (generation !== statusReadGeneration) {
      return
    }
    if (getProviderRuntimeContextKey(get().settings) !== contextKey) {
      return
    }
    applyStatus(contextKey, status, bump)
  }

  return {
    clickUpStatus: DISCONNECTED,
    clickUpStatusChecked: false,
    clickUpStatusContextKey: null,
    clickUpConnectionRevision: 0,

    checkClickUpConnection: () => refreshStatus(false),

    connectClickUp: async (apiToken) => {
      try {
        const result = await clickUpConnect(get().settings, apiToken)
        if (result.ok) {
          await refreshStatus(true)
        }
        return result
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : 'Connection failed'
        }
      }
    },

    testClickUpConnection: async () => {
      try {
        const result = await clickUpTestConnection(get().settings)
        await refreshStatus(false)
        return result
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : 'Connection failed'
        }
      }
    },

    selectClickUpWorkspace: async (workspaceId) => {
      await clickUpSelectWorkspace(get().settings, workspaceId)
      await refreshStatus(true)
    },

    disconnectClickUp: async () => {
      await clickUpDisconnect(get().settings)
      await refreshStatus(true)
    }
  }
}
