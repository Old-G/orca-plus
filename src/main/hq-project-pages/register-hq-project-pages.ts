// Custom build (hq): IPC for HQ's tabs; the work is in hq-project-pages-service.ts, which the
// paired web client reaches through the hqProjects.* runtime RPC.
import { ipcMain } from 'electron'
import type { Store } from '../persistence'
import {
  createHqProjectPagesService,
  provideHqProjectPagesService
} from './hq-project-pages-service'

export function registerHqProjectPagesHandlers(store: Store): void {
  const service = createHqProjectPagesService(store)
  provideHqProjectPagesService(service)
  ipcMain.handle('hqProjects:list', () => service.list())
  ipcMain.handle('hqProjects:wikiTree', () => service.wikiTree())
  ipcMain.handle('hqProjects:wikiPage', (_event, path: unknown) => service.wikiPage(path))
  ipcMain.handle('hqProjects:projectDiagram', (_event, repoId: unknown) =>
    service.projectDiagram(repoId)
  )
  ipcMain.handle('hqProjects:reviews', (_event, refresh: unknown) => service.reviews(refresh))
  ipcMain.handle('hqProjects:gitState', (_event, paths: unknown) => service.gitState(paths))
  ipcMain.handle('hqProjects:map', () => service.map())
}
