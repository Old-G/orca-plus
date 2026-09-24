import { ipcRenderer } from 'electron'
import type { PreloadApi } from '../api-types'

export const customAppearanceBackgroundApi = {
  pick: () => ipcRenderer.invoke('customAppearance:pickBackground'),
  read: (fileName: string) => ipcRenderer.invoke('customAppearance:readBackground', fileName),
  clear: () => ipcRenderer.invoke('customAppearance:clearBackground')
} satisfies PreloadApi['customAppearanceBackground']
