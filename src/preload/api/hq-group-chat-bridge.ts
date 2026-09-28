import { ipcRenderer } from 'electron'
import type { PreloadApi } from '../api-types'

export const hqGroupChatApi = {
  prepare: (projectGroupId) => ipcRenderer.invoke('hqGroupChat:prepare', projectGroupId)
} satisfies PreloadApi['hqGroupChat']
