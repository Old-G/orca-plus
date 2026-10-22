import { ipcRenderer } from 'electron'
import type { PreloadApi } from '../api-types'

export const gmailApi = {
  status: () => ipcRenderer.invoke('gmail:status'),
  importClient: () => ipcRenderer.invoke('gmail:importClient'),
  connect: () => ipcRenderer.invoke('gmail:connect'),
  disconnect: () => ipcRenderer.invoke('gmail:disconnect')
} satisfies PreloadApi['gmail']
