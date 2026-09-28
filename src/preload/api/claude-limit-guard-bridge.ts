import { ipcRenderer } from 'electron'
import type { ClaudeLimitStoppedAgent } from '../../shared/claude-limit-guard'
import type { PreloadApi } from '../api-types'

export const claudeLimitGuardApi = {
  list: () => ipcRenderer.invoke('claudeLimitGuard:list'),
  onStopsChanged: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, stops: ClaudeLimitStoppedAgent[]): void =>
      callback(stops)
    ipcRenderer.on('claudeLimitGuard:stopsChanged', listener)
    return () => ipcRenderer.removeListener('claudeLimitGuard:stopsChanged', listener)
  }
} satisfies PreloadApi['claudeLimitGuard']
