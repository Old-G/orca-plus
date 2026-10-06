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
import type { HqSlackScoutCreateResult, HqSlackScoutResult } from '../../shared/hq-slack-scout'

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
  /** Custom build (hq-slack-scout): drafts the Slack scout wrote; Create makes the ClickUp task. */
  slackDrafts: () => Promise<HqSlackScoutResult>
  rejectSlackDraft: (ref: { id: string }) => Promise<HqSlackScoutCreateResult | { ok: true }>
  createSlackDraftTask: (draft: {
    id: string
    title: string
    description: string
  }) => Promise<HqSlackScoutCreateResult>
  /** Paired web client only: HQ's settings, which live on the Mac. The desktop reads its own. */
  settings?: () => Promise<HqClientSettings>
}
