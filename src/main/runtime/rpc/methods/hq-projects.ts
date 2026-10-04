import { defineMethod } from '../core'
import {
  HqGitStateParams,
  HqProjectDiagramParams,
  HqReviewsParams,
  HqUpdateSettingsParams,
  HqWikiPageParams
} from '../../../../shared/rpc-contract/hq-projects-params'
import {
  getHqProjectPagesService,
  type HqProjectPagesService
} from '../../../hq-project-pages/hq-project-pages-service'

function service(): HqProjectPagesService {
  const provided = getHqProjectPagesService()
  if (!provided) {
    throw new Error('HQ is not available on this host.')
  }
  return provided
}

// Custom build (hq): the same reads desktop HQ makes over IPC, for the paired web client.
export const HQ_PROJECTS_METHODS = [
  defineMethod({
    name: 'hqProjects.list',
    params: null,
    handler: async () => service().list()
  }),
  defineMethod({
    name: 'hqProjects.wikiTree',
    params: null,
    handler: async () => service().wikiTree()
  }),
  defineMethod({
    name: 'hqProjects.wikiPage',
    params: HqWikiPageParams,
    handler: async (params) => service().wikiPage(params.path)
  }),
  defineMethod({
    name: 'hqProjects.projectDiagram',
    params: HqProjectDiagramParams,
    handler: async (params) => service().projectDiagram(params.repoId)
  }),
  defineMethod({
    name: 'hqProjects.reviews',
    params: HqReviewsParams,
    handler: async (params) => service().reviews(params?.refresh === true)
  }),
  defineMethod({
    name: 'hqProjects.gitState',
    params: HqGitStateParams,
    handler: async (params) => service().gitState(params.paths)
  }),
  defineMethod({
    name: 'hqProjects.map',
    params: null,
    handler: async () => service().map()
  }),
  defineMethod({
    name: 'hqProjects.settings',
    params: null,
    handler: async () => service().settings()
  }),
  defineMethod({
    name: 'hqProjects.updateSettings',
    params: HqUpdateSettingsParams,
    handler: async (params) => service().updateSettings(params)
  })
]
