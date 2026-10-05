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
  /** Paired web client only: HQ's settings, which live on the Mac. The desktop reads its own. */
  settings?: () => Promise<HqClientSettings>
}
