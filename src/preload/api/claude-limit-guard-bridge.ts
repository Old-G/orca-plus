import { ipcRenderer } from 'electron'
import type { ClaudeLimitStoppedAgent } from '../../shared/claude-limit-guard'
import type { PreloadApi } from '../api-types'

export const claudeLimitGuardApi = {
  list: () => ipcRenderer.invoke('claudeLimitGuard:list'),
  continueAuthStops: () => ipcRenderer.invoke('claudeLimitGuard:continueAuthStops'),
  continueOnSubscription: (args) =>
    ipcRenderer.invoke('claudeLimitGuard:continueOnSubscription', args),
  onStopsChanged: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, stops: ClaudeLimitStoppedAgent[]): void =>
      callback(stops)
    ipcRenderer.on('claudeLimitGuard:stopsChanged', listener)
    return () => ipcRenderer.removeListener('claudeLimitGuard:stopsChanged', listener)
  }
} satisfies PreloadApi['claudeLimitGuard']
