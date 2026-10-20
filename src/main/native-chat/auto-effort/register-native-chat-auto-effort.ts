// Custom build (chat-auto-effort): the setting, the OpenRouter key and the classifier, bound at startup.
import { ipcMain } from 'electron'
import type { Store } from '../../persistence'
import { pickEffortWithJev } from './jev-effort-pick'
import { provideNativeChatAutoEffort, recentAutoEffortOutcomes } from './native-chat-auto-effort'
import type { ChatAutoEffortStatus } from '../../../shared/chat-auto-effort-status'
import {
  clearOpenRouterKey,
  hasOpenRouterKey,
  loadOpenRouterKey,
  saveOpenRouterKey
} from './openrouter-key-store'

function keyStatus(): ChatAutoEffortStatus {
  const configured = hasOpenRouterKey()
  return {
    configured,
    readable: configured && loadOpenRouterKey() !== null,
    recent: recentAutoEffortOutcomes()
  }
}

export function registerNativeChatAutoEffort(store: Store): void {
  provideNativeChatAutoEffort({
    enabled: () => store.getSettings().nativeChatAutoEffort === true,
    key: loadOpenRouterKey,
    pick: pickEffortWithJev
  })
  ipcMain.handle('hqProjects:autoEffortKeyStatus', (): ChatAutoEffortStatus => keyStatus())
  ipcMain.handle('hqProjects:saveAutoEffortKey', (_event, key: unknown): ChatAutoEffortStatus => {
    if (typeof key !== 'string' || !key.trim()) {
      throw new Error('OpenRouter key must be a non-empty string')
    }
    saveOpenRouterKey(key.trim())
    return keyStatus()
  })
  ipcMain.handle('hqProjects:clearAutoEffortKey', (): ChatAutoEffortStatus => {
    clearOpenRouterKey()
    return keyStatus()
  })
}
