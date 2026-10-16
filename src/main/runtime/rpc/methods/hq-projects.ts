import { defineMethod } from '../core'
import {
  HqDraftTaskQuestionsParams,
  HqGitStateParams,
  HqProjectDiagramParams,
  HqReviewsParams,
  HqClickUpReplyParams,
  HqSlackDraftCreateParams,
  HqSlackDraftEditParams,
  HqSlackDraftRefParams,
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

    permission: 'workspace',
    params: null,
    handler: async () => service().list()
  }),
  defineMethod({
    name: 'hqProjects.wikiTree',

    permission: 'workspace',
    params: null,
    handler: async () => service().wikiTree()
  }),
  defineMethod({
    name: 'hqProjects.wikiPage',

    permission: 'workspace',
    params: HqWikiPageParams,
    handler: async (params) => service().wikiPage(params.path)
  }),
  defineMethod({
    name: 'hqProjects.projectDiagram',

    permission: 'workspace',
    params: HqProjectDiagramParams,
    handler: async (params) => service().projectDiagram(params.repoId)
  }),
  defineMethod({
    name: 'hqProjects.reviews',

    permission: 'workspace',
    params: HqReviewsParams,
    handler: async (params) => service().reviews(params?.refresh === true)
  }),
  defineMethod({
    name: 'hqProjects.gitState',

    permission: 'workspace',
    params: HqGitStateParams,
    handler: async (params) => service().gitState(params.paths)
  }),
  defineMethod({
    name: 'hqProjects.map',

    permission: 'workspace',
    params: null,
    handler: async () => service().map()
  }),
  defineMethod({
    name: 'hqProjects.draftTaskQuestions',

    permission: 'workspace',
    params: HqDraftTaskQuestionsParams,
    handler: async (params) => service().draftTaskQuestions(params)
  }),
  defineMethod({
    name: 'hqProjects.slackDrafts',

    permission: 'workspace',
    params: null,
    handler: async () => service().slackDrafts()
  }),
  defineMethod({
    name: 'hqProjects.rejectSlackDraft',

    permission: 'workspace',
    params: HqSlackDraftRefParams,
    handler: async (params) => service().rejectSlackDraft(params.id)
  }),
  defineMethod({
    name: 'hqProjects.createSlackDraftTask',

    permission: 'workspace',
    params: HqSlackDraftCreateParams,
    handler: async (params) => service().createSlackDraftTask(params)
  }),
  defineMethod({
    name: 'hqProjects.answerSlackDraft',

    permission: 'workspace',
    params: HqSlackDraftRefParams,
    handler: async (params) => service().answerSlackDraft(params.id)
  }),
  defineMethod({
    name: 'hqProjects.editSlackDraft',

    permission: 'workspace',
    params: HqSlackDraftEditParams,
    handler: async (params) => service().editSlackDraft(params)
  }),
  defineMethod({
    name: 'hqProjects.takeSlackDraft',

    permission: 'workspace',
    params: HqSlackDraftRefParams,
    handler: async (params) => service().takeSlackDraft(params.id)
  }),
  defineMethod({
    name: 'hqProjects.restoreSlackDraft',

    permission: 'workspace',
    params: HqSlackDraftRefParams,
    handler: async (params) => service().restoreSlackDraft(params.id)
  }),
  defineMethod({
    name: 'hqProjects.draftClickUpReply',

    permission: 'workspace',
    params: HqSlackDraftRefParams,
    handler: async (params) => service().draftClickUpReply(params.id)
  }),
  defineMethod({
    name: 'hqProjects.sendClickUpReply',

    permission: 'workspace',
    params: HqClickUpReplyParams,
    handler: async (params) => service().sendClickUpReply(params)
  }),
  defineMethod({
    name: 'hqProjects.settings',

    permission: 'workspace',
    params: null,
    handler: async () => service().settings()
  }),
  defineMethod({
    name: 'hqProjects.updateSettings',

    permission: 'settings-write',
    params: HqUpdateSettingsParams,
    handler: async (params) => service().updateSettings(params)
  })
]
