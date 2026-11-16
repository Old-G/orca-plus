import { ipcRenderer } from 'electron'
import type { ClaudeLimitStoppedAgent } from '../../shared/claude-limit-guard'
import type { ClaudeBackgroundPause } from '../../shared/claude-background-pause'
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
  },
  backgroundPause: () => ipcRenderer.invoke('claudeLimitGuard:backgroundPause'),
  onBackgroundPauseChanged: (callback) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      pause: ClaudeBackgroundPause | null
    ): void => callback(pause)
    ipcRenderer.on('claudeLimitGuard:backgroundPauseChanged', listener)
    return () => ipcRenderer.removeListener('claudeLimitGuard:backgroundPauseChanged', listener)
  }
} satisfies PreloadApi['claudeLimitGuard']
