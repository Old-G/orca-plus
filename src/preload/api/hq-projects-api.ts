import type {
  HqProjectDiagramResult,
  HqProjectMapResult,
  HqProjectPagesResult,
  HqReviewsResult,
  HqWorktreeGitStates,
  HqWikiPageResult,
  HqWikiTreeResult
} from '../../shared/hq-project-pages'
import type { HqClientSettings } from '../../shared/hq-client-settings'
import type { HqTaskQuestionsResult } from '../../shared/hq-triage'
import type {
  HqVoiceIdeaResult,
  HqVoiceRewriteMode,
  HqVoiceRewriteResult,
  HqVoiceTaskResult
} from '../../shared/hq-voice-prompts'
import type { HqReadAloudSpeechResult } from '../../shared/hq-read-aloud'
import type {
  HqSlackScoutCreateResult,
  HqSlackScoutEdit,
  HqSlackScoutResult
} from '../../shared/hq-slack-scout'

export type HqProjectsApi = {
  list: () => Promise<HqProjectPagesResult>
  wikiTree: () => Promise<HqWikiTreeResult>
  wikiPage: (path: string) => Promise<HqWikiPageResult>
  map: () => Promise<HqProjectMapResult>
  projectDiagram: (repoId: string) => Promise<HqProjectDiagramResult>
  /** Cached for two minutes in main; `refresh` reads again. */
  reviews: (refresh?: boolean) => Promise<HqReviewsResult>
  /** Local absolute paths only; each read is cached for a minute in main. */
  gitState: (paths: string[]) => Promise<HqWorktreeGitStates>
  /** Custom build (hq-task-questions): Claude drafts questions to the task's author; nothing is sent. */
  draftTaskQuestions: (task: {
    identifier: string
    title: string
    description: string
  }) => Promise<HqTaskQuestionsResult>
  /** Custom build (hq-voice-prompts): a dictation rewritten by Claude; an idea filed in HQ/ideas. */
  voiceRewrite: (request: {
    mode: HqVoiceRewriteMode
    text: string
  }) => Promise<HqVoiceRewriteResult>
  saveIdea: (request: { text: string }) => Promise<HqVoiceIdeaResult>
  /** The ClickUp-mode text as a task where slack-scout/config.yaml says; only on the owner's press. */
  createVoiceTask: (request: { text: string }) => Promise<HqVoiceTaskResult>
  /** Custom build (hq-read-aloud): one piece of an answer in a natural voice, as mp3. */
  readAloudSpeech: (request: { text: string; voice: string }) => Promise<HqReadAloudSpeechResult>
  /** Custom build (hq-slack-scout): drafts the Slack scout wrote; Create makes the ClickUp task. */
  slackDrafts: () => Promise<HqSlackScoutResult>
  rejectSlackDraft: (ref: { id: string }) => Promise<HqSlackScoutCreateResult | { ok: true }>
  createSlackDraftTask: (draft: {
    id: string
    title: string
    description: string
  }) => Promise<HqSlackScoutCreateResult>
  /** Custom build (hq-slack-requests): «Just reply» and the owner's corrections. */
  answerSlackDraft: (ref: { id: string }) => Promise<HqSlackScoutCreateResult | { ok: true }>
  editSlackDraft: (
    edit: HqSlackScoutEdit & { id: string }
  ) => Promise<HqSlackScoutCreateResult | { ok: true }>
  /** Custom build (hq-clickup-requests): «Do» on a ClickUp comment, and the reply drafted then sent. */
  takeSlackDraft: (ref: { id: string }) => Promise<HqSlackScoutCreateResult | { ok: true }>
  /** Custom build (hq-done-journal): a skipped request back among the pending ones. */
  restoreSlackDraft: (ref: { id: string }) => Promise<{ ok: true } | { ok: false; error: string }>
  /** Custom build (hq-mobile): Do / Just reply a paired phone asked this window to run. */
  onRunRequest?: (
    listener: (request: { id: string; action: 'do' | 'answer' }) => void
  ) => () => void
  onRunBellAction?: (
    listener: (request: { itemId: string; actionId: string }) => void
  ) => () => void
  draftClickUpReply: (ref: {
    id: string
  }) => Promise<{ ok: true; text: string } | { ok: false; error: string }>
  sendClickUpReply: (reply: {
    id: string
    text: string
    draft?: string
  }) => Promise<{ ok: true } | { ok: false; error: string }>
  /** Paired web client only: HQ's settings, which live on the Mac. The desktop reads its own. */
  settings?: () => Promise<HqClientSettings>
}
