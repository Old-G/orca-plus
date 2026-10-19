// Custom build (chat-auto-effort): the setting, the OpenRouter key and the classifier, bound at startup.
import { ipcMain } from 'electron'
import type { Store } from '../../persistence'
import { pickEffortWithJev } from './jev-effort-pick'
import { provideNativeChatAutoEffort } from './native-chat-auto-effort'
import {
  clearOpenRouterKey,
  hasOpenRouterKey,
  loadOpenRouterKey,
  saveOpenRouterKey
} from './openrouter-key-store'

export type AutoEffortKeyStatus = { configured: boolean }

export function registerNativeChatAutoEffort(store: Store): void {
  provideNativeChatAutoEffort({
    enabled: () => store.getSettings().nativeChatAutoEffort === true,
    key: loadOpenRouterKey,
    pick: pickEffortWithJev
  })
  ipcMain.handle('hqProjects:autoEffortKeyStatus', (): AutoEffortKeyStatus => ({
    configured: hasOpenRouterKey()
  }))
  ipcMain.handle('hqProjects:saveAutoEffortKey', (_event, key: unknown): AutoEffortKeyStatus => {
    if (typeof key !== 'string' || !key.trim()) {
      throw new Error('OpenRouter key must be a non-empty string')
    }
    saveOpenRouterKey(key.trim())
    return { configured: true }
  })
  ipcMain.handle('hqProjects:clearAutoEffortKey', (): AutoEffortKeyStatus => {
    clearOpenRouterKey()
    return { configured: false }
  })
}
