// Custom build (hq): IPC for HQ's tabs; the work is in hq-project-pages-service.ts, which the
// paired web client reaches through the hqProjects.* runtime RPC.
import { homedir } from 'node:os'
import { BrowserWindow, ipcMain } from 'electron'
import type { Store } from '../persistence'
import type { CommitMessageAgentEnvironmentResolvers } from '../text-generation/commit-message-agent-environment'
import {
  HqDraftTaskQuestionsParams,
  HqClickUpReplyParams,
  HqSlackDraftCreateParams,
  HqSlackDraftEditParams,
  HqSlackDraftRefParams,
  HqVoiceIdeaParams,
  HqVoiceRewriteParams
} from '../../shared/rpc-contract/hq-projects-params'
import {
  createHqVoiceTask,
  rewriteHqVoiceText,
  saveHqIdea
} from '../hq-today/hq-voice-prompts-service'
import { keepHqApprovalEdits } from '../hq-today/hq-reply-corrections'
import { setHqDesktopSender } from '../hq-today/hq-request-on-desktop'
import {
  bindOutgoingApprovalHqPath,
  onOutgoingApprovalDecided
} from '../orca-plus/outgoing-approval/register-outgoing-approval'
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
  // Custom build (outgoing-approval-target): the scout's files name the DMs approval cards send to.
  bindOutgoingApprovalHqPath(() => store.getSettings().hqPath ?? null)
  // Custom build (hq-mobile): one window only, so a phone's Do never runs twice.
  setHqDesktopSender((channel, payload) => {
    const window =
      BrowserWindow.getFocusedWindow() ??
      BrowserWindow.getAllWindows().find((entry) => !entry.isDestroyed())
    window?.webContents.send(channel, payload)
    return Boolean(window)
  })
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
  // Custom build (hq-voice-prompts): desktop only — the web client has no dictation.
  ipcMain.handle('hqProjects:voiceRewrite', (_event, request: unknown) =>
    rewriteHqVoiceText(HqVoiceRewriteParams.parse(request), store.getSettings().hqPath ?? null, {
      settings: store.getSettings(),
      cwd: store.getSettings().hqPath ?? homedir(),
      getAgentEnvResolvers
    })
  )
  ipcMain.handle('hqProjects:saveIdea', (_event, request: unknown) =>
    saveHqIdea(HqVoiceIdeaParams.parse(request).text, store.getSettings().hqPath ?? null)
  )
  ipcMain.handle('hqProjects:createVoiceTask', (_event, request: unknown) =>
    createHqVoiceTask(HqVoiceIdeaParams.parse(request).text, store.getSettings().hqPath ?? null)
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
