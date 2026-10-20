// Custom build (hq): IPC for HQ's tabs; the work is in hq-project-pages-service.ts, which the
// paired web client reaches through the hqProjects.* runtime RPC.
import { BrowserWindow, ipcMain } from 'electron'
import type { Store } from '../persistence'
import type { CommitMessageAgentEnvironmentResolvers } from '../text-generation/commit-message-agent-environment'
import {
  HqDraftTaskQuestionsParams,
  HqClickUpReplyParams,
  HqSlackDraftCreateParams,
  HqSlackDraftEditParams,
  HqSlackDraftRefParams,
  HqReadAloudSpeechParams,
  HqVoiceIdeaParams,
  HqVoiceRewriteParams
} from '../../shared/rpc-contract/hq-projects-params'
import { synthesizeHqReadAloud } from '../hq-today/hq-read-aloud-speech'
import { keepHqApprovalEdits } from '../hq-today/hq-reply-corrections'
import { setHqDesktopSender } from '../hq-today/hq-request-on-desktop'
import { publishHqChatList } from '../hq-today/hq-chat-list-snapshot'
import {
  bindOutgoingApprovalHqPath,
  onOutgoingApprovalDecided
} from '../orca-plus/outgoing-approval/register-outgoing-approval'
import {
  createHqProjectPagesService,
  provideHqProjectPagesService
} from './hq-project-pages-service'
import { startHqSpaceGitAuthors } from '../hq-today/hq-space-git-authors'
import { listHqSpaces } from '../hq-today/hq-spaces'
import { gitExecFileAsync } from '../git/runner'
import { registerHqBundledSkills } from '../hq-bundled-skills/register-hq-bundled-skills'
import { isGitRepoKind } from '../../shared/repo-kind'
import { registerNativeChatAutoEffort } from '../native-chat/auto-effort/register-native-chat-auto-effort'

export function registerHqProjectPagesHandlers(
  store: Store,
  getAgentEnvResolvers: () => CommitMessageAgentEnvironmentResolvers | undefined
): void {
  const service = createHqProjectPagesService(store, getAgentEnvResolvers)
  provideHqProjectPagesService(service)
  // Custom build (chat-auto-effort): a Claude chat's effort follows each message.
  registerNativeChatAutoEffort(store)
  // Custom build (hq-bundled-skills): the HQ skills and the HQ folder pointer their scripts read.
  registerHqBundledSkills(store)
  // Custom build (hq-reply-tone): a Slack message rewritten in Approve becomes a tone lesson.
  onOutgoingApprovalDecided(keepHqApprovalEdits(() => store.getSettings().hqPath ?? null))
  // Custom build (outgoing-approval-target): the scout's files name the DMs approval cards send to.
  bindOutgoingApprovalHqPath(() => store.getSettings().hqPath ?? null)
  // Custom build (hq-space-git): each workspace's commit author in its projects' local git config.
  startHqSpaceGitAuthors({
    spaces: async () => {
      const hqPath = store.getSettings().hqPath
      return hqPath ? listHqSpaces(hqPath) : []
    },
    repos: () =>
      store.getRepos().map((repo) => ({
        id: repo.id,
        path: repo.path,
        local: !repo.connectionId && isGitRepoKind(repo)
      })),
    readLocal: async (path, key) => {
      try {
        return (
          (
            await gitExecFileAsync(['config', '--local', '--get', key], { cwd: path })
          ).stdout.trim() || null
        )
      } catch {
        // Why: `--get` exits 1 for an unset key.
        return null
      }
    },
    writeLocal: async (path, key, value) => {
      await gitExecFileAsync(['config', '--local', key, value], { cwd: path })
    }
  })
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
  ipcMain.handle('hqProjects:reports', () => service.reports())
  ipcMain.handle('hqProjects:publishChatList', (_event, items: unknown) => {
    publishHqChatList(items)
  })
  ipcMain.handle('hqProjects:projectDiagram', (_event, repoId: unknown) =>
    service.projectDiagram(repoId)
  )
  ipcMain.handle('hqProjects:reviews', (_event, refresh: unknown) => service.reviews(refresh))
  ipcMain.handle('hqProjects:gitState', (_event, paths: unknown) => service.gitState(paths))
  ipcMain.handle('hqProjects:map', () => service.map())
  ipcMain.handle('hqProjects:draftTaskQuestions', (_event, task: unknown) =>
    service.draftTaskQuestions(HqDraftTaskQuestionsParams.parse(task))
  )
  ipcMain.handle('hqProjects:voiceRewrite', (_event, request: unknown) =>
    service.voiceRewrite(HqVoiceRewriteParams.parse(request))
  )
  ipcMain.handle('hqProjects:saveIdea', (_event, request: unknown) =>
    service.saveIdea(HqVoiceIdeaParams.parse(request).text)
  )
  // Custom build (hq-read-aloud): desktop only — the key stays on the Mac.
  ipcMain.handle('hqProjects:readAloudSpeech', (_event, request: unknown) =>
    synthesizeHqReadAloud(HqReadAloudSpeechParams.parse(request))
  )
  ipcMain.handle('hqProjects:createVoiceTask', (_event, request: unknown) =>
    service.createVoiceTask(HqVoiceIdeaParams.parse(request).text)
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
