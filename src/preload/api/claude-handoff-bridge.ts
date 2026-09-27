import { ipcRenderer } from 'electron'
import type { ClaudeHandoffOffer } from '../../shared/claude-handoff-file'
import type { PreloadApi } from '../api-types'

export const claudeHandoffApi = {
  list: () => ipcRenderer.invoke('claudeHandoff:list'),
  launch: (id) => ipcRenderer.invoke('claudeHandoff:launch', id),
  dismiss: (id) => ipcRenderer.invoke('claudeHandoff:dismiss', id),
  onOffersChanged: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, offers: ClaudeHandoffOffer[]): void =>
      callback(offers)
    ipcRenderer.on('claudeHandoff:offersChanged', listener)
    return () => ipcRenderer.removeListener('claudeHandoff:offersChanged', listener)
  }
} satisfies PreloadApi['claudeHandoff']
