// Custom build (hq): HQ's Orca+ settings in the paired web client. They live on the Mac: HQ loads
// them when it opens, every settings read then carries the last copy, and HQ's own edits (linked
// ClickUp lists, closed deferred sessions) are written back there, so phone and desktop share them.
import type { PreloadApi } from '../../../../preload/api-types'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import {
  HQ_CLIENT_WRITABLE_SETTING_KEYS,
  type HqClientSettings
} from '../../../../shared/hq-client-settings'
import { callRuntimeResult } from './web-runtime-calls'

let lastHqSettings: Partial<GlobalSettings> = {}

export async function loadRuntimeHqSettings(): Promise<HqClientSettings> {
  const loaded = await callRuntimeResult<HqClientSettings>('hqProjects.settings', undefined, 15_000)
  lastHqSettings = loaded
  return loaded
}

async function writeRuntimeHqSettings(updates: Partial<GlobalSettings>): Promise<void> {
  const changed = Object.fromEntries(
    HQ_CLIENT_WRITABLE_SETTING_KEYS.filter((key) => updates[key] !== undefined).map((key) => [
      key,
      updates[key]
    ])
  )
  if (Object.keys(changed).length > 0) {
    lastHqSettings = await callRuntimeResult<HqClientSettings>('hqProjects.updateSettings', changed)
  }
}

/** The web settings API, carrying HQ's settings from the Mac and writing HQ's edits back there. */
export function withRuntimeHqSettings(api: Partial<PreloadApi>): Partial<PreloadApi> {
  const settings = api.settings
  if (!settings) {
    return api
  }
  return {
    ...api,
    settings: {
      ...settings,
      get: async () => ({ ...(await settings.get()), ...lastHqSettings }),
      getSync: () => {
        const local = settings.getSync()
        return local ? { ...local, ...lastHqSettings } : local
      },
      set: async (updates) => {
        const result = await settings.set(updates)
        await writeRuntimeHqSettings(updates)
        return { ...result, ...lastHqSettings }
      }
    }
  }
}
