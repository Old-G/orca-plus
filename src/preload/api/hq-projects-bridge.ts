import { ipcRenderer } from 'electron'
import type { PreloadApi } from '../api-types'

export const hqProjectsApi = {
  list: () => ipcRenderer.invoke('hqProjects:list'),
  wikiTree: () => ipcRenderer.invoke('hqProjects:wikiTree'),
  wikiPage: (path) => ipcRenderer.invoke('hqProjects:wikiPage', path),
  map: () => ipcRenderer.invoke('hqProjects:map'),
  projectDiagram: (repoId) => ipcRenderer.invoke('hqProjects:projectDiagram', repoId),
  reviews: (refresh) => ipcRenderer.invoke('hqProjects:reviews', refresh === true),
  gitState: (paths) => ipcRenderer.invoke('hqProjects:gitState', paths)
} satisfies PreloadApi['hqProjects']
