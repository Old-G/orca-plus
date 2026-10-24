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
  HqWikiPageParams,
  HqPinnedSeenParams,
  HqPinnedCountsParams,
  HqSpaceKeyParams,
  HqPersonParams,
  HqRoomCreateParams,
  HqRoomUpdateParams,
  HqRoomRemoveParams
} from '../../../../shared/rpc-contract/hq-projects-params'
import type { OrcaRuntimeService } from '../../orca-runtime'
import {
  buildHqPeopleRows,
  buildHqPersonCard,
  readHqPeopleFiles
} from '../../../hq-today/hq-people'
import { markHqPinnedSeen, readHqPinnedCounts } from '../../../hq-today/hq-pinned-counts'
import { listHqSpaces } from '../../../hq-today/hq-spaces'
import { addHqRoom } from '../../../hq-context/hq-room-add'
import {
  createHqRoomWithGroup,
  hqRoomGroupsOf,
  removeHqRoom,
  updateHqRoom
} from '../../../hq-context/hq-room-edit'
import { listHqSpaceKeys, setHqSpaceKey } from '../../../hq-today/hq-space-keys'
import { OUTGOING_APPROVAL_BELL_KIND } from '../../../../shared/outgoing-approval/outgoing-approval-bell'
import {
  runHqBellActionOnDesktop,
  runHqReportDecisionsOnDesktop,
  runHqRequestOnDesktop
} from '../../../hq-today/hq-request-on-desktop'
import { readHqChatList } from '../../../hq-today/hq-chat-list-snapshot'
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

// Custom build (hq-people): the org matrix and person pages joined with the pulse's people.
async function peopleSources(runtime: OrcaRuntimeService) {
  const hqPath = service().settings().hqPath
  return {
    files: hqPath ? await readHqPeopleFiles(hqPath) : { org: [], pages: [] },
    people: runtime.pulseListPeople(),
    waitings: runtime.pulseListWaitings({ status: 'open' })
  }
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
  // Custom build (hq-mobile-messenger): the phone's HQ chat list, as the desktop window built it.
  defineMethod({
    name: 'hqProjects.chatList',

    permission: 'workspace',
    params: null,
    handler: async () => readHqChatList()
  }),
  // Custom build (hq-pinned-counts): the counts beside HQ's pinned items, and an item just opened.
  defineMethod({
    name: 'hqProjects.pinnedCounts',

    permission: 'workspace',
    params: HqPinnedCountsParams,
    handler: async (params, { runtime }) =>
      readHqPinnedCounts(runtime, service(), Date.now(), params?.space)
  }),
  // Custom build (hq-spaces): the workspaces under the global HQ, with their projects.
  defineMethod({
    name: 'hqProjects.spaces',

    permission: 'workspace',
    params: null,
    handler: async () => {
      const hqPath = service().settings().hqPath
      return { ok: true, spaces: hqPath ? await listHqSpaces(hqPath) : [] }
    }
  }),
  // Custom build (hq-people): HQ's People list, and one person's card.
  defineMethod({
    name: 'hqProjects.people',

    permission: 'workspace',
    params: null,
    handler: async (_params, { runtime }) => ({
      ok: true,
      people: buildHqPeopleRows(await peopleSources(runtime))
    })
  }),
  defineMethod({
    name: 'hqProjects.person',

    permission: 'workspace',
    params: HqPersonParams,
    handler: async (params, { runtime }) => {
      const sources = await peopleSources(runtime)
      const row = buildHqPeopleRows(sources).find((entry) => entry.key === params.key)
      if (!row) {
        return { ok: false, error: 'No such person.' }
      }
      const decisions = runtime.pulseListDecisions(500)
      return { ok: true, ...buildHqPersonCard(row, { ...sources, decisions }) }
    }
  }),
  defineMethod({
    name: 'hqProjects.markPinnedSeen',

    permission: 'workspace',
    params: HqPinnedSeenParams,
    handler: async (params) => markHqPinnedSeen(service(), params.id, Date.now())
  }),
  // Custom build (hq-space-keys): which workspaces keep their own tokens, and saving one — on the Mac only.
  // Custom build (hq-rooms): HQ+'s «+» and a room's menu — the room and its sidebar group together.
  defineMethod({
    name: 'hqProjects.roomCreate',

    permission: 'settings-write',
    params: HqRoomCreateParams,
    handler: async (params, { runtime }) => {
      const hqPath = service().settings().hqPath
      if (!hqPath) {
        throw new Error('HQ is not set up.')
      }
      return createHqRoomWithGroup(hqRoomGroupsOf(runtime), params, (groupId) =>
        addHqRoom(hqPath, { name: params.name, color: params.color, groupId })
      )
    }
  }),
  defineMethod({
    name: 'hqProjects.roomUpdate',

    permission: 'settings-write',
    params: HqRoomUpdateParams,
    handler: async (params, { runtime }) => {
      const hqPath = service().settings().hqPath
      if (!hqPath) {
        throw new Error('HQ is not set up.')
      }
      await updateHqRoom(hqRoomGroupsOf(runtime), hqPath, params.space, params)
      return { ok: true }
    }
  }),
  defineMethod({
    name: 'hqProjects.roomRemove',

    permission: 'settings-write',
    params: HqRoomRemoveParams,
    handler: async (params, { runtime }) => {
      const hqPath = service().settings().hqPath
      if (!hqPath) {
        throw new Error('HQ is not set up.')
      }
      return removeHqRoom(hqRoomGroupsOf(runtime), hqPath, params.space, new Date())
    }
  }),
  defineMethod({
    name: 'hqProjects.spaceKeys',

    permission: 'workspace',
    params: null,
    handler: async () => listHqSpaceKeys()
  }),
  defineMethod({
    name: 'hqProjects.setSpaceKey',

    permission: 'settings-write',
    params: HqSpaceKeyParams,
    handler: async (params) => setHqSpaceKey(params.space, params.kind, params.value)
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
