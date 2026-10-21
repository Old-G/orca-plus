import { ipcRenderer } from 'electron'
import type { PreloadApi } from '../api-types'

export const slackApi = {
  connect: (args) => ipcRenderer.invoke('slack:connect', args),
  disconnect: () => ipcRenderer.invoke('slack:disconnect'),
  status: () => ipcRenderer.invoke('slack:status'),
  sendTest: () => ipcRenderer.invoke('slack:sendTest'),
  setTarget: (args) => ipcRenderer.invoke('slack:setTarget', args),
  connectReader: (token) => ipcRenderer.invoke('slack:connectReader', token),
  disconnectReader: () => ipcRenderer.invoke('slack:disconnectReader')
} satisfies PreloadApi['slack']
