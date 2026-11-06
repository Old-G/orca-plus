import { ipcRenderer } from 'electron'
import type { PreloadApi } from '../api-types'

export const orcaPlusPowerApi = {
  isOnBattery: () => ipcRenderer.invoke('orcaPlusPower:isOnBattery'),
  onChanged: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, change: { onBattery: boolean }): void =>
      callback(change)
    ipcRenderer.on('orcaPlusPower:changed', listener)
    return () => ipcRenderer.removeListener('orcaPlusPower:changed', listener)
  }
} satisfies PreloadApi['orcaPlusPower']
