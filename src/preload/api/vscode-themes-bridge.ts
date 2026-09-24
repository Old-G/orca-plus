import { ipcRenderer } from 'electron'
import type { PreloadApi } from '../api-types'

export const vscodeThemesApi = {
  listInstalled: () => ipcRenderer.invoke('vscodeThemes:listInstalled'),
  searchOpenVsx: (query) => ipcRenderer.invoke('vscodeThemes:searchOpenVsx', query),
  openSource: (request) => ipcRenderer.invoke('vscodeThemes:openSource', request),
  importTheme: (token, label) => ipcRenderer.invoke('vscodeThemes:importTheme', token, label),
  listImported: () => ipcRenderer.invoke('vscodeThemes:listImported'),
  readImported: (id) => ipcRenderer.invoke('vscodeThemes:readImported', id),
  removeImported: (id) => ipcRenderer.invoke('vscodeThemes:removeImported', id)
} satisfies PreloadApi['vscodeThemes']
