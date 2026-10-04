import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PreloadApi } from '../../../../preload/api-types'
import { getDefaultSettings } from '../../../../shared/constants'
import type { GlobalSettings } from '../../../../shared/global-settings-types'

const calls = vi.hoisted(() => ({ log: new Array<{ method: string; params: unknown }>() }))

vi.mock('./web-runtime-calls', () => ({
  callRuntimeResult: async (method: string, params?: unknown) => {
    calls.log.push({ method, params })
    return method === 'hqProjects.settings'
      ? { hqPath: '/hq', hqDeferredDismissed: {} }
      : { hqPath: '/hq', hqDeferredDismissed: { pane: 1 } }
  }
}))

import { loadRuntimeHqSettings, withRuntimeHqSettings } from './web-hq-settings'

function webSettings(): { api: Partial<PreloadApi>; set: ReturnType<typeof vi.fn> } {
  const local = getDefaultSettings('/home')
  const set = vi.fn(async (updates: Partial<GlobalSettings>) => ({ ...local, ...updates }))
  const api: Partial<PreloadApi> = {}
  Object.assign(api, { settings: { get: async () => local, getSync: () => local, set } })
  return { api: withRuntimeHqSettings(api), set }
}

afterEach(() => {
  calls.log.length = 0
})

describe('web HQ settings', () => {
  it('asks the Mac nothing until HQ loads its settings, then every read carries them', async () => {
    const { api } = webSettings()
    await api.settings?.get()
    await api.settings?.set({ compactWorktreeCards: true })
    expect(calls.log).toEqual([])

    await loadRuntimeHqSettings()
    expect((await api.settings?.get())?.hqPath).toBe('/hq')
    expect(api.settings?.getSync()?.hqPath).toBe('/hq')
  })

  it('writes only HQ edits back to the Mac', async () => {
    const { api, set } = webSettings()
    const result = await api.settings?.set({ hqDeferredDismissed: { pane: 1 }, hqPath: '/x' })
    expect(set).toHaveBeenCalledTimes(1)
    expect(calls.log).toEqual([
      { method: 'hqProjects.updateSettings', params: { hqDeferredDismissed: { pane: 1 } } }
    ])
    expect(result?.hqPath).toBe('/hq')
  })
})
