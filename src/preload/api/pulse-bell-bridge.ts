import { ipcRenderer } from 'electron'
import type { PreloadApi } from '../api-types'

export const pulseBellApi = {
  list: () => ipcRenderer.invoke('pulseBell:list'),
  markRead: (ids) => ipcRenderer.invoke('pulseBell:markRead', ids),
  markDone: (id, action) => ipcRenderer.invoke('pulseBell:markDone', id, action),
  syncKind: (kind, items) => ipcRenderer.invoke('pulseBell:syncKind', kind, items),
  onChanged: (callback) => {
    const listener = (): void => callback()
    ipcRenderer.on('pulseBell:changed', listener)
    return () => ipcRenderer.removeListener('pulseBell:changed', listener)
  }
} satisfies PreloadApi['pulseBell']
