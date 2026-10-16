// Custom build (hq): IPC for HQ's tabs; the work is in hq-project-pages-service.ts, which the
// paired web client reaches through the hqProjects.* runtime RPC.
import { ipcMain } from 'electron'
import type { Store } from '../persistence'
import type { CommitMessageAgentEnvironmentResolvers } from '../text-generation/commit-message-agent-environment'
import {
  HqDraftTaskQuestionsParams,
  HqClickUpReplyParams,
  HqSlackDraftCreateParams,
  HqSlackDraftEditParams,
  HqSlackDraftRefParams
} from '../../shared/rpc-contract/hq-projects-params'
import { keepHqApprovalEdits } from '../hq-today/hq-reply-corrections'
import { onOutgoingApprovalDecided } from '../orca-plus/outgoing-approval/register-outgoing-approval'
import {
  createHqProjectPagesService,
  provideHqProjectPagesService
} from './hq-project-pages-service'

export function registerHqProjectPagesHandlers(
  store: Store,
  getAgentEnvResolvers: () => CommitMessageAgentEnvironmentResolvers | undefined
): void {
  const service = createHqProjectPagesService(store, getAgentEnvResolvers)
  provideHqProjectPagesService(service)
  // Custom build (hq-reply-tone): a Slack message rewritten in Approve becomes a tone lesson.
  onOutgoingApprovalDecided(keepHqApprovalEdits(() => store.getSettings().hqPath ?? null))
  ipcMain.handle('hqProjects:list', () => service.list())
  ipcMain.handle('hqProjects:wikiTree', () => service.wikiTree())
  ipcMain.handle('hqProjects:wikiPage', (_event, path: unknown) => service.wikiPage(path))
  ipcMain.handle('hqProjects:projectDiagram', (_event, repoId: unknown) =>
    service.projectDiagram(repoId)
  )
  ipcMain.handle('hqProjects:reviews', (_event, refresh: unknown) => service.reviews(refresh))
  ipcMain.handle('hqProjects:gitState', (_event, paths: unknown) => service.gitState(paths))
  ipcMain.handle('hqProjects:map', () => service.map())
  ipcMain.handle('hqProjects:draftTaskQuestions', (_event, task: unknown) =>
    service.draftTaskQuestions(HqDraftTaskQuestionsParams.parse(task))
  )
  ipcMain.handle('hqProjects:slackDrafts', () => service.slackDrafts())
  ipcMain.handle('hqProjects:rejectSlackDraft', (_event, ref: unknown) =>
    service.rejectSlackDraft(HqSlackDraftRefParams.parse(ref).id)
  )
  ipcMain.handle('hqProjects:createSlackDraftTask', (_event, draft: unknown) =>
    service.createSlackDraftTask(HqSlackDraftCreateParams.parse(draft))
  )
  ipcMain.handle('hqProjects:answerSlackDraft', (_event, ref: unknown) =>
    service.answerSlackDraft(HqSlackDraftRefParams.parse(ref).id)
  )
  ipcMain.handle('hqProjects:editSlackDraft', (_event, edit: unknown) =>
    service.editSlackDraft(HqSlackDraftEditParams.parse(edit))
  )
  ipcMain.handle('hqProjects:takeSlackDraft', (_event, ref: unknown) =>
    service.takeSlackDraft(HqSlackDraftRefParams.parse(ref).id)
  )
  ipcMain.handle('hqProjects:restoreSlackDraft', (_event, ref: unknown) =>
    service.restoreSlackDraft(HqSlackDraftRefParams.parse(ref).id)
  )
  ipcMain.handle('hqProjects:draftClickUpReply', (_event, ref: unknown) =>
    service.draftClickUpReply(HqSlackDraftRefParams.parse(ref).id)
  )
  ipcMain.handle('hqProjects:sendClickUpReply', (_event, reply: unknown) =>
    service.sendClickUpReply(HqClickUpReplyParams.parse(reply))
  )
}
