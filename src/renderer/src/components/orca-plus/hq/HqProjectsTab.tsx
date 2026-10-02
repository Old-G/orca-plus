// Custom build (hq): the HQ «Projects» tab — every project by group, with what moves and what blocks;
// a click opens the project's card.
import { useMemo, useState } from 'react'
import { useNow } from '@/hooks/use-now'
import { translate } from '@/i18n/i18n'
import { formatShortTimeAgo } from '@/lib/short-time-ago'
import { useAppStore } from '@/store'
import { useLiveDashboardSnapshot } from '../../dashboard/useLiveDashboardSnapshot'
import { buildHqProjectBoard, type HqProjectCard } from './hq-project-board'
import { HqProjectDetail } from './HqProjectDetail'
import type { HqWaiting } from './hq-pulse-snapshot'
import type { Worktree } from '../../../../../shared/worktree/types'
import { useHqProjectPages, type HqProjectPagesState } from './use-hq-project-pages'
import { useHqPulse } from './use-hq-pulse'

const AGE_TICK_MS = 60_000
const NO_WAITINGS: readonly HqWaiting[] = []
const NO_WORKTREES: readonly Worktree[] = []

type Stat = { key: string; text: string; attention?: boolean }

function cardStats(project: HqProjectCard): Stat[] {
  const stats: Stat[] = []
  if (project.agentsNeedYou > 0) {
    stats.push({
      key: 'needYou',
      text: translate('auto.hq.projects.needYou', '{{value0}} waiting on you', {
        value0: String(project.agentsNeedYou)
      }),
      attention: true
    })
  }
  if (project.agentsWorking > 0) {
    stats.push({
      key: 'working',
      text: translate('auto.hq.projects.working', '{{value0}} working', {
        value0: String(project.agentsWorking)
      })
    })
  }
  if (project.openReviews > 0) {
    stats.push({
      key: 'reviews',
      text: translate('auto.hq.projects.reviews', '{{value0}} in review', {
        value0: String(project.openReviews)
      })
    })
  }
  if (project.openWaitings > 0) {
    stats.push({
      key: 'waitings',
      text: translate('auto.hq.projects.waitings', 'Waitings: {{value0}}', {
        value0: String(project.openWaitings)
      }),
      attention: true
    })
  }
  return stats
}

function ProjectCard({
  project,
  now,
  onSelect
}: {
  project: HqProjectCard
  now: number
  onSelect: (repoId: string) => void
}): React.JSX.Element {
  const stats = cardStats(project)
  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(project.repoId)}
        className="flex h-full w-full flex-col gap-1.5 rounded-lg border border-border bg-card p-3 text-left text-card-foreground hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        <span className="flex items-baseline gap-2">
          <span className="min-w-0 flex-1 truncate text-sm font-medium">{project.name}</span>
          {project.status ? (
            <span className="shrink-0 text-[11px] text-muted-foreground">{project.status}</span>
          ) : null}
        </span>
        {project.summary ? (
          <span className="line-clamp-2 text-xs text-muted-foreground">{project.summary}</span>
        ) : null}
        {stats.length > 0 ? (
          <span className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
            {stats.map((stat) => (
              <span
                key={stat.key}
                data-attention={stat.attention === true}
                className="text-muted-foreground data-[attention=true]:font-medium data-[attention=true]:text-foreground"
              >
                {stat.text}
              </span>
            ))}
          </span>
        ) : null}
        <span className="mt-auto flex items-center gap-2 pt-1 text-[11px] text-muted-foreground">
          <span className="flex-1">
            {translate('auto.hq.projects.workspaces', 'Workspaces: {{value0}}', {
              value0: String(project.worktreeCount)
            })}
          </span>
          {project.lastActivityAt ? (
            <span className="tabular-nums">{formatShortTimeAgo(project.lastActivityAt, now)}</span>
          ) : null}
        </span>
      </button>
    </li>
  )
}

function pagesNote(pages: HqProjectPagesState): string | null {
  if (pages.status === 'off') {
    return translate(
      'auto.hq.projects.hqOff',
      'Set an HQ folder in Settings to see project summaries and waitings by project.'
    )
  }
  if (pages.status === 'error') {
    return translate('auto.hq.projects.pagesFailed', "Couldn't read HQ project pages: {{value0}}", {
      value0: pages.message
    })
  }
  return null
}

export function HqProjectsTab(): React.JSX.Element {
  const repos = useAppStore((s) => s.repos)
  const projectGroups = useAppStore((s) => s.projectGroups)
  const worktreesByRepo = useAppStore((s) => s.worktreesByRepo)
  const snapshot = useLiveDashboardSnapshot()
  const pulse = useHqPulse()
  const pages = useHqProjectPages()
  const now = useNow(AGE_TICK_MS)
  const waitings = pulse.status === 'ready' ? pulse.pulse.waitings : NO_WAITINGS
  const pageList = pages.status === 'ready' ? pages.pages : null
  const sections = useMemo(
    () =>
      buildHqProjectBoard({
        repos,
        projectGroups,
        worktreesByRepo,
        snapshot,
        waitings,
        pages: pageList ?? []
      }),
    [repos, projectGroups, worktreesByRepo, snapshot, waitings, pageList]
  )
  const [selectedRepoId, setSelectedRepoId] = useState<string | null>(null)
  const selected = sections
    .flatMap((section) => section.projects)
    .find((project) => project.repoId === selectedRepoId)
  const selectedRepo = repos.find((repo) => repo.id === selectedRepoId)
  // Why: a project removed while its card is open falls back to the board.
  if (selected && selectedRepo) {
    return (
      <HqProjectDetail
        project={selected}
        repo={selectedRepo}
        page={pageList?.find((page) => page.repoId === selected.repoId) ?? null}
        pages={pageList ?? []}
        worktrees={(worktreesByRepo[selected.repoId] ?? NO_WORKTREES).filter(
          (worktree) => !worktree.isArchived
        )}
        snapshot={snapshot}
        pulse={pulse}
        now={now}
        onBack={() => setSelectedRepoId(null)}
        onSelectProject={setSelectedRepoId}
      />
    )
  }
  const note = pagesNote(pages)
  return (
    <div className="scrollbar-sleek flex h-full min-h-0 flex-col gap-6 overflow-y-auto p-4">
      {note ? <p className="text-xs text-muted-foreground">{note}</p> : null}
      {sections.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {translate('auto.hq.projects.empty', 'No projects yet.')}
        </p>
      ) : null}
      {sections.map((section) => {
        const title = section.name ?? translate('auto.hq.projects.ungrouped', 'Other projects')
        return (
          <section key={section.id} className="flex flex-col gap-3" aria-label={title}>
            <h2 className="flex items-center gap-2 text-[11px] font-semibold tracking-[0.05em] text-muted-foreground uppercase">
              {title}
              <span className="tabular-nums">{section.projects.length}</span>
            </h2>
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              {section.projects.map((project) => (
                <ProjectCard
                  key={project.repoId}
                  project={project}
                  now={now}
                  onSelect={setSelectedRepoId}
                />
              ))}
            </ul>
          </section>
        )
      })}
    </div>
  )
}
