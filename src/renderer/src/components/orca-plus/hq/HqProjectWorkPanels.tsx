// Custom build (hq): a project card's live work — its agents and its workspaces, each opening on click.
import {
  DASHBOARD_BUCKET_ORDER,
  type DashboardBucket,
  type DashboardCard,
  type DashboardWorkspace
} from '../../../../../shared/dashboard-snapshot'
import type { Worktree } from '../../../../../shared/worktree/types'
import { translate } from '@/i18n/i18n'
import { formatShortTimeAgo } from '@/lib/short-time-ago'
import { activateAndRevealWorkspace } from '@/lib/worktree-activation'
import { revealDashboardAgent } from '../../dashboard/reveal-dashboard-agent'
import { ColumnHeader } from './hq-waiting-parts'

const ROW_CLASS =
  'flex w-full flex-col gap-0.5 rounded-md px-2 py-1.5 text-left hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none'

function bucketLabel(bucket: DashboardBucket): string {
  switch (bucket) {
    case 'attention':
      return translate('dashboardPopout.bucket.attention', 'Needs You')
    case 'working':
      return translate('dashboardPopout.bucket.working', 'Working')
    case 'done':
      return translate('dashboardPopout.bucket.done', 'Done')
    case 'idle':
      return translate('dashboardPopout.bucket.idle', 'Idle')
  }
}

export function HqProjectAgents({ cards }: { cards: readonly DashboardCard[] }): React.JSX.Element {
  const title = translate('auto.hq.project.agents', 'Agents')
  const sorted = [...cards].sort(
    (a, b) =>
      DASHBOARD_BUCKET_ORDER.indexOf(a.bucket) - DASHBOARD_BUCKET_ORDER.indexOf(b.bucket) ||
      b.stateChangedAt - a.stateChangedAt
  )
  return (
    <section className="flex flex-col gap-2" aria-label={title}>
      <ColumnHeader title={title} count={cards.length} />
      {sorted.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {translate('auto.hq.project.noAgents', 'No agents in this project.')}
        </p>
      ) : (
        <ul className="flex flex-col">
          {sorted.map((card) => (
            <li key={card.paneKey}>
              <button
                type="button"
                className={ROW_CLASS}
                onClick={() =>
                  revealDashboardAgent({
                    repoId: card.repoId,
                    worktreeId: card.worktreeId,
                    executionHostId: card.executionHostId,
                    tabId: card.tabId,
                    leafId: card.leafId
                  })
                }
              >
                <span className="flex w-full items-baseline gap-2">
                  <span className="min-w-0 flex-1 truncate text-[13px]">
                    {card.conversationName || card.task || card.agentType}
                  </span>
                  <span
                    data-bucket={card.bucket}
                    className="shrink-0 text-xs text-muted-foreground data-[bucket=attention]:font-medium data-[bucket=attention]:text-foreground"
                  >
                    {bucketLabel(card.bucket)}
                  </span>
                </span>
                <span className="w-full truncate text-xs text-muted-foreground">
                  {[card.worktreeName, card.askSummary].filter(Boolean).join(' · ')}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function branchName(branch: string): string {
  return branch.replace(/^refs\/heads\//, '')
}

export function HqProjectWorkspaces({
  worktrees,
  workspaces,
  now
}: {
  worktrees: readonly Worktree[]
  workspaces: readonly DashboardWorkspace[]
  now: number
}): React.JSX.Element {
  const title = translate('auto.hq.project.workspaces', 'Workspaces')
  const reviews = new Map(workspaces.map((workspace) => [workspace.worktreeId, workspace.review]))
  const sorted = [...worktrees].sort((a, b) => b.lastActivityAt - a.lastActivityAt)
  return (
    <section className="flex flex-col gap-2" aria-label={title}>
      <ColumnHeader title={title} count={worktrees.length} />
      {sorted.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {translate('auto.hq.project.noWorkspaces', 'No workspaces open.')}
        </p>
      ) : (
        <ul className="flex flex-col">
          {sorted.map((worktree) => {
            const review = reviews.get(worktree.id)
            const openReview = review?.state === 'open' || review?.state === 'draft'
            const branch = branchName(worktree.branch)
            return (
              <li key={worktree.id}>
                <button
                  type="button"
                  className={ROW_CLASS}
                  onClick={() => activateAndRevealWorkspace(worktree.id)}
                >
                  <span className="flex w-full items-baseline gap-2">
                    <span className="min-w-0 flex-1 truncate text-[13px]">
                      {worktree.displayName}
                    </span>
                    {review && openReview ? (
                      <span className="shrink-0 text-xs font-medium">
                        {translate('auto.hq.project.review', '#{{value0}} in review', {
                          value0: String(review.number)
                        })}
                      </span>
                    ) : null}
                    {worktree.lastActivityAt ? (
                      <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
                        {formatShortTimeAgo(worktree.lastActivityAt, now)}
                      </span>
                    ) : null}
                  </span>
                  {branch && branch !== worktree.displayName ? (
                    <span className="w-full truncate font-mono text-[11px] text-muted-foreground">
                      {branch}
                    </span>
                  ) : null}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
