import { ipcRenderer } from 'electron'
import type { PreloadApi } from '../api-types'
import type { OrcaPlusThemeAutoMode } from './orca-plus-theme-api'

export const orcaPlusThemeApi = {
  getAuto: () => ipcRenderer.invoke('orcaPlusTheme:getAuto'),
  setAuto: (mode) => ipcRenderer.invoke('orcaPlusTheme:setAuto', mode),
  onAutoChanged: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, mode: OrcaPlusThemeAutoMode): void =>
      callback(mode)
    ipcRenderer.on('orcaPlusTheme:autoChanged', listener)
    return () => ipcRenderer.removeListener('orcaPlusTheme:autoChanged', listener)
  }
} satisfies PreloadApi['orcaPlusTheme']
