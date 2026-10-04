// Custom build (hq): HQ's reads in the paired web client, through the hqProjects.* runtime RPC, and
// ClickUp (the Mac holds the token), whose methods take the same params as the clickup.* RPC.
import type { PreloadApi } from '../../../../preload/api-types'
import { loadRuntimeHqSettings } from './web-hq-settings'
import { createRuntimeNamespaceApi } from './web-review-api'
import { callRuntimeResult } from './web-runtime-calls'

// Why: the all-projects map renders through archify on the Mac for up to two minutes.
const MAP_TIMEOUT_MS = 150_000

export function createWebHqProjectsApi(): Pick<PreloadApi, 'hqProjects' | 'clickup'> {
  return {
    clickup: createRuntimeNamespaceApi('clickup'),
    hqProjects: {
      list: () => callRuntimeResult('hqProjects.list'),
      wikiTree: () => callRuntimeResult('hqProjects.wikiTree'),
      wikiPage: (path) => callRuntimeResult('hqProjects.wikiPage', { path }),
      map: () => callRuntimeResult('hqProjects.map', undefined, MAP_TIMEOUT_MS),
      projectDiagram: (repoId) => callRuntimeResult('hqProjects.projectDiagram', { repoId }),
      reviews: (refresh) => callRuntimeResult('hqProjects.reviews', { refresh: refresh === true }),
      gitState: (paths) => callRuntimeResult('hqProjects.gitState', { paths }),
      settings: () => loadRuntimeHqSettings()
    }
  }
}
