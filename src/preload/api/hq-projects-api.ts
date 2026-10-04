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
  /** Paired web client only: HQ's settings, which live on the Mac. The desktop reads its own. */
  settings?: () => Promise<HqClientSettings>
}
