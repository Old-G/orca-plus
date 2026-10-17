import { ipcRenderer } from 'electron'
import type { PreloadApi } from '../api-types'

export const hqProjectsApi = {
  list: () => ipcRenderer.invoke('hqProjects:list'),
  wikiTree: () => ipcRenderer.invoke('hqProjects:wikiTree'),
  wikiPage: (path) => ipcRenderer.invoke('hqProjects:wikiPage', path),
  reports: () => ipcRenderer.invoke('hqProjects:reports'),
  publishChatList: (items) => ipcRenderer.invoke('hqProjects:publishChatList', items),
  map: () => ipcRenderer.invoke('hqProjects:map'),
  projectDiagram: (repoId) => ipcRenderer.invoke('hqProjects:projectDiagram', repoId),
  reviews: (refresh) => ipcRenderer.invoke('hqProjects:reviews', refresh === true),
  gitState: (paths) => ipcRenderer.invoke('hqProjects:gitState', paths),
  draftTaskQuestions: (task) => ipcRenderer.invoke('hqProjects:draftTaskQuestions', task),
  voiceRewrite: (request) => ipcRenderer.invoke('hqProjects:voiceRewrite', request),
  saveIdea: (request) => ipcRenderer.invoke('hqProjects:saveIdea', request),
  createVoiceTask: (request) => ipcRenderer.invoke('hqProjects:createVoiceTask', request),
  readAloudSpeech: (request) => ipcRenderer.invoke('hqProjects:readAloudSpeech', request),
  slackDrafts: () => ipcRenderer.invoke('hqProjects:slackDrafts'),
  rejectSlackDraft: (ref) => ipcRenderer.invoke('hqProjects:rejectSlackDraft', ref),
  createSlackDraftTask: (draft) => ipcRenderer.invoke('hqProjects:createSlackDraftTask', draft),
  answerSlackDraft: (ref) => ipcRenderer.invoke('hqProjects:answerSlackDraft', ref),
  editSlackDraft: (edit) => ipcRenderer.invoke('hqProjects:editSlackDraft', edit),
  takeSlackDraft: (ref) => ipcRenderer.invoke('hqProjects:takeSlackDraft', ref),
  restoreSlackDraft: (ref) => ipcRenderer.invoke('hqProjects:restoreSlackDraft', ref),
  draftClickUpReply: (ref) => ipcRenderer.invoke('hqProjects:draftClickUpReply', ref),
  sendClickUpReply: (reply) => ipcRenderer.invoke('hqProjects:sendClickUpReply', reply),
  onRunRequest: (listener) => {
    const handler = (_event: unknown, request: { id: string; action: 'do' | 'answer' }): void =>
      listener(request)
    ipcRenderer.on('hqProjects:runRequest', handler)
    return () => ipcRenderer.removeListener('hqProjects:runRequest', handler)
  },
  onRunBellAction: (listener) => {
    const handler = (_event: unknown, request: { itemId: string; actionId: string }): void =>
      listener(request)
    ipcRenderer.on('hqProjects:runBellAction', handler)
    return () => ipcRenderer.removeListener('hqProjects:runBellAction', handler)
  },
  onRunReportDecisions: (listener) => {
    const handler = (_event: unknown, request: { path: string; text: string }): void =>
      listener(request)
    ipcRenderer.on('hqProjects:runReportDecisions', handler)
    return () => ipcRenderer.removeListener('hqProjects:runReportDecisions', handler)
  }
} satisfies PreloadApi['hqProjects']
