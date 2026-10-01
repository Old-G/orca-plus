import { ipcRenderer } from 'electron'
import type { PreloadApi } from '../api-types'

export const claudeSubscriptionsApi = {
  status: (args) => ipcRenderer.invoke('claudeSubscriptions:status', args),
  login: (args) => ipcRenderer.invoke('claudeSubscriptions:login', args),
  assignSession: (args) => ipcRenderer.invoke('claudeSubscriptions:assignSession', args)
} satisfies PreloadApi['claudeSubscriptions']
