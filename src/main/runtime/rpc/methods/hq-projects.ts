import { defineMethod } from '../core'
import {
  HqBellActionOnDesktopParams,
  HqDraftTaskQuestionsParams,
  HqRequestOnDesktopParams,
  HqGitStateParams,
  HqProjectDiagramParams,
  HqReportDecisionsParams,
  HqReviewsParams,
  HqClickUpReplyParams,
  HqSlackDraftCreateParams,
  HqSlackDraftEditParams,
  HqSlackDraftRefParams,
  HqUpdateSettingsParams,
  HqVoiceIdeaParams,
  HqVoiceRewriteParams,
  HqWikiPageParams
} from '../../../../shared/rpc-contract/hq-projects-params'
import { OUTGOING_APPROVAL_BELL_KIND } from '../../../../shared/outgoing-approval/outgoing-approval-bell'
import {
  runHqBellActionOnDesktop,
  runHqReportDecisionsOnDesktop,
  runHqRequestOnDesktop
} from '../../../hq-today/hq-request-on-desktop'
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
  // Custom build (hq-reports): the phone's Reports tab, and its decisions run in the Mac's window.
  defineMethod({
    name: 'hqProjects.reports',

    permission: 'workspace',
    params: null,
    handler: async () => service().reports()
  }),
  defineMethod({
    name: 'hqProjects.reportDecisionsOnDesktop',

    permission: 'workspace',
    params: HqReportDecisionsParams,
    handler: async (params) => runHqReportDecisionsOnDesktop(params.path, params.text)
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
  // Custom build (hq-voice-prompts): the phone's dictation, rewritten and filed by the Mac.
  defineMethod({
    name: 'hqProjects.voiceRewrite',

    permission: 'workspace',
    params: HqVoiceRewriteParams,
    handler: async (params) => service().voiceRewrite(params)
  }),
  defineMethod({
    name: 'hqProjects.saveIdea',

    permission: 'workspace',
    params: HqVoiceIdeaParams,
    handler: async (params) => service().saveIdea(params.text)
  }),
  defineMethod({
    name: 'hqProjects.createVoiceTask',

    permission: 'workspace',
    params: HqVoiceIdeaParams,
    handler: async (params) => service().createVoiceTask(params.text)
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
    name: 'hqProjects.runRequestOnDesktop',

    permission: 'workspace',
    params: HqRequestOnDesktopParams,
    handler: async (params) => runHqRequestOnDesktop(params.id, params.action)
  }),
  defineMethod({
    name: 'hqProjects.runBellActionOnDesktop',

    permission: 'workspace',
    params: HqBellActionOnDesktopParams,
    handler: async (params, { runtime }) => {
      const item = runtime.pulseListInbox(true).find((entry) => entry.id === params.itemId)
      if (!item) {
        return { ok: false, error: 'This bell item is gone.' }
      }
      // Why: approving what goes out in the owner's name stays on the Mac (owner, 16.10).
      if (item.kind === OUTGOING_APPROVAL_BELL_KIND) {
        return { ok: false, error: 'Approve this on your Mac.' }
      }
      return runHqBellActionOnDesktop(item.id, params.actionId)
    }
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
