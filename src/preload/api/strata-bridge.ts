import { ipcRenderer } from 'electron'
import type { PreloadApi } from '../api-types'

export const strataApi = {
  status: (repoIds) => ipcRenderer.invoke('strata:status', repoIds),
  adopt: (repoId) => ipcRenderer.invoke('strata:adopt', repoId)
} satisfies PreloadApi['strata']
