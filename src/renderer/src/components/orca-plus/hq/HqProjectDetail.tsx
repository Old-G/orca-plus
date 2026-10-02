// Custom build (hq): one project's card on the HQ «Projects» tab — its ClickUp tasks, HQ page and map
// on the left; its agents, waitings, workspaces and feed on the right.
import { ArrowLeft } from 'lucide-react'
import type { DashboardSnapshot } from '../../../../../shared/dashboard-snapshot'
import type { HqProjectPage } from '../../../../../shared/hq-project-pages'
import { isFolderRepo } from '../../../../../shared/repo-kind'
import type { Repo } from '../../../../../shared/repo-types'
import type { Worktree } from '../../../../../shared/worktree/types'
import { Button } from '@/components/ui/button'
import CommentMarkdown from '@/components/sidebar/CommentMarkdown'
import { translate } from '@/i18n/i18n'
import { activateAndRevealWorkspace } from '@/lib/worktree-activation'
import type { HqProjectCard } from './hq-project-board'
import { hqWikiBody, resolveHqWikiLink } from './hq-wiki-tree'
import { HqProjectDiagram } from './HqProjectDiagram'
import { HqProjectFeed, HqProjectWaitings } from './HqProjectPulsePanels'
import { HqProjectTasks } from './HqProjectTasks'
import { HqProjectAgents, HqProjectWorkspaces } from './HqProjectWorkPanels'
import type { HqPulseState } from './use-hq-pulse'
import { useHqProjectCommits } from './use-hq-project-commits'
import { useHqWikiPage } from './use-hq-wiki-page'

const FEED_COMMITS = 10

export function hqProjectPagePath(slug: string): string {
  return `projects/${slug}.md`
}

function HqProjectOverview({
  page,
  pages,
  onSelectProject
}: {
  page: HqProjectPage | null
  pages: readonly HqProjectPage[]
  onSelectProject: (repoId: string) => void
}): React.JSX.Element {
  const wiki = useHqWikiPage(page ? hqProjectPagePath(page.slug) : null)
  const title = translate('auto.hq.project.overview', 'Overview')
  let body: React.JSX.Element
  if (!wiki) {
    body = (
      <p className="text-xs text-muted-foreground">
        {translate(
          'auto.hq.project.noPage',
          'HQ has no page for this project yet. Run the HQ sync to write one.'
        )}
      </p>
    )
  } else if (wiki.status === 'ready') {
    body = (
      <CommentMarkdown
        variant="document"
        content={hqWikiBody(wiki.markdown)}
        className="text-sm"
        onLinkClick={(event, href) => {
          const target = resolveHqWikiLink(wiki.path, href)
          if (!target) {
            return
          }
          // Why: a page links its related projects by their HQ pages; follow those to their cards.
          event.preventDefault()
          const related = pages.find((candidate) => hqProjectPagePath(candidate.slug) === target)
          if (related) {
            onSelectProject(related.repoId)
          }
        }}
      />
    )
  } else {
    body = (
      <p className="text-xs text-muted-foreground">
        {wiki.status === 'loading'
          ? translate('auto.hq.waiting.loading', 'Loading…')
          : translate('auto.hq.wiki.pageFailed', "Couldn't read this page: {{value0}}", {
              value0: wiki.message
            })}
      </p>
    )
  }
  return (
    <section className="flex min-w-0 flex-col gap-2" aria-label={title}>
      <h2 className="text-[11px] font-semibold tracking-[0.05em] text-muted-foreground uppercase">
        {title}
      </h2>
      {body}
    </section>
  )
}

export function HqProjectDetail({
  project,
  repo,
  page,
  pages,
  worktrees,
  snapshot,
  pulse,
  now,
  onBack,
  onSelectProject
}: {
  project: HqProjectCard
  repo: Repo
  page: HqProjectPage | null
  pages: readonly HqProjectPage[]
  /** The project's workspaces, archived ones already left out. */
  worktrees: readonly Worktree[]
  snapshot: Pick<DashboardSnapshot, 'cards' | 'workspaces'>
  pulse: HqPulseState
  now: number
  onBack: () => void
  onSelectProject: (repoId: string) => void
}): React.JSX.Element {
  const openWorktreeId = project.openWorktreeId
  const openWorktree = worktrees.find((worktree) => worktree.id === openWorktreeId) ?? null
  const commits = useHqProjectCommits(
    openWorktree && !isFolderRepo(repo)
      ? { repoId: repo.id, worktreeId: openWorktree.id, worktreePath: openWorktree.path }
      : null,
    FEED_COMMITS
  )
  const slug = page?.slug ?? null
  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-1.5">
        <Button type="button" variant="ghost" size="xs" onClick={onBack}>
          <ArrowLeft />
          {translate('auto.hq.project.back', 'All projects')}
        </Button>
        <h1 className="min-w-0 truncate text-sm font-medium">{project.name}</h1>
        {project.status ? (
          <span className="shrink-0 text-[11px] text-muted-foreground">{project.status}</span>
        ) : null}
        <span className="flex-1" />
        <Button
          type="button"
          variant="secondary"
          size="xs"
          disabled={!openWorktreeId}
          onClick={() => {
            if (openWorktreeId) {
              activateAndRevealWorkspace(openWorktreeId)
            }
          }}
        >
          {translate('auto.hq.project.open', 'Open')}
        </Button>
      </header>
      <div className="scrollbar-sleek min-h-0 flex-1 overflow-y-auto">
        <div className="grid grid-cols-1 gap-6 p-4 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="flex min-w-0 flex-col gap-6">
            <HqProjectTasks key={repo.id} repoId={repo.id} />
            <HqProjectOverview page={page} pages={pages} onSelectProject={onSelectProject} />
            <HqProjectDiagram repoId={repo.id} />
          </div>
          <div className="flex min-w-0 flex-col gap-6">
            <HqProjectAgents cards={snapshot.cards.filter((card) => card.repoId === repo.id)} />
            <HqProjectWaitings pulse={pulse} slug={slug} now={now} />
            <HqProjectWorkspaces
              worktrees={worktrees}
              workspaces={(snapshot.workspaces ?? []).filter(
                (workspace) => workspace.repoId === repo.id
              )}
              now={now}
            />
            <HqProjectFeed commits={commits} pulse={pulse} slug={slug} now={now} />
          </div>
        </div>
      </div>
    </div>
  )
}
