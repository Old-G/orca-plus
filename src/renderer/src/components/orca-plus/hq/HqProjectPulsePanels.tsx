// Custom build (hq): a project card's pulse side — waitings bound to the project, and its feed of
// recent commits and decisions.
import type { PulseWaitingDirection } from '../../../../../shared/pulse-types'
import { translate } from '@/i18n/i18n'
import { formatShortTimeAgo } from '@/lib/short-time-ago'
import { buildHqProjectFeed } from './hq-project-feed'
import { ColumnHeader, QuickAdd, WaitingCard, decisionLabel } from './hq-waiting-parts'
import type { HqPulseState } from './use-hq-pulse'
import type { HqProjectCommitsState } from './use-hq-project-commits'

const FEED_LIMIT = 12

function directionTitle(direction: PulseWaitingDirection): string {
  return direction === 'on-me'
    ? translate('auto.hq.waiting.onMe', 'Waiting on me')
    : translate('auto.hq.waiting.onThem', "I'm waiting on")
}

function pulseProblem(pulse: HqPulseState): string | null {
  if (pulse.status === 'loading') {
    return translate('auto.hq.waiting.loading', 'Loading…')
  }
  if (pulse.status === 'error') {
    return translate('auto.hq.waiting.loadFailed', "Couldn't read waitings: {{value0}}", {
      value0: pulse.message
    })
  }
  return null
}

export function HqProjectWaitings({
  pulse,
  slug,
  now
}: {
  pulse: HqPulseState
  /** Null when HQ has no page for the project, so nothing can name it. */
  slug: string | null
  now: number
}): React.JSX.Element {
  const title = translate('auto.hq.project.waitings', 'Waitings')
  const waitings =
    pulse.status === 'ready' && slug
      ? pulse.pulse.waitings.filter((waiting) => waiting.project === slug)
      : []
  const people = pulse.status === 'ready' ? pulse.pulse.people : []
  const names = new Map(people.map((person) => [person.id, person.name]))
  const note = slug
    ? pulseProblem(pulse)
    : translate(
        'auto.hq.project.noSlug',
        'HQ has no page for this project yet, so waitings cannot be tied to it.'
      )
  return (
    <section className="flex flex-col gap-3" aria-label={title}>
      <ColumnHeader title={title} count={waitings.length} />
      {note ? <p className="text-xs text-muted-foreground">{note}</p> : null}
      {slug && pulse.status === 'ready'
        ? (['on-me', 'on-them'] as const).map((direction) => {
            const list = waitings.filter((waiting) => waiting.direction === direction)
            return (
              <div key={direction} className="flex flex-col gap-2">
                <h3 className="text-xs text-muted-foreground">
                  {directionTitle(direction)}
                  {list.length > 0 ? ` · ${list.length}` : ''}
                </h3>
                <QuickAdd direction={direction} people={people} project={slug} />
                {list.length > 0 ? (
                  <ul className="flex flex-col gap-2">
                    {list.map((waiting) => (
                      <WaitingCard
                        key={waiting.id}
                        waiting={waiting}
                        personName={waiting.personId ? (names.get(waiting.personId) ?? null) : null}
                        now={now}
                      />
                    ))}
                  </ul>
                ) : null}
              </div>
            )
          })
        : null}
    </section>
  )
}

function commitsNote(commits: HqProjectCommitsState): string | null {
  switch (commits.status) {
    case 'none':
      return translate('auto.hq.project.noGit', 'No git checkout to read commits from.')
    case 'loading':
      return translate('auto.hq.waiting.loading', 'Loading…')
    case 'error':
      return translate('auto.hq.project.commitsFailed', "Couldn't read commits: {{value0}}", {
        value0: commits.message
      })
    case 'ready':
      return null
  }
}

export function HqProjectFeed({
  commits,
  pulse,
  slug,
  now
}: {
  commits: HqProjectCommitsState
  pulse: HqPulseState
  slug: string | null
  now: number
}): React.JSX.Element {
  const title = translate('auto.hq.project.feed', 'Feed')
  const feed = buildHqProjectFeed(
    commits.status === 'ready' ? commits.commits : [],
    pulse.status === 'ready' ? pulse.pulse.decisions : [],
    slug,
    FEED_LIMIT
  )
  const note = commitsNote(commits)
  return (
    <section className="flex flex-col gap-2" aria-label={title}>
      <ColumnHeader title={title} count={feed.length} />
      {note ? <p className="text-xs text-muted-foreground">{note}</p> : null}
      {feed.length === 0 && !note ? (
        <p className="text-xs text-muted-foreground">
          {translate('auto.hq.project.emptyFeed', 'Nothing recent.')}
        </p>
      ) : null}
      {feed.length > 0 ? (
        <ul className="flex flex-col">
          {feed.map((entry) => (
            <li
              key={entry.id}
              className="flex items-baseline gap-2 border-b border-border py-1.5 text-[13px] last:border-b-0"
            >
              {entry.kind === 'commit' ? (
                <span className="w-14 shrink-0 truncate font-mono text-[11px] text-muted-foreground">
                  {entry.hash}
                </span>
              ) : (
                <span
                  data-outcome={entry.decision.outcome ?? 'decision'}
                  className="w-14 shrink-0 truncate text-[11px] font-medium data-[outcome=rejected]:text-destructive"
                >
                  {decisionLabel(entry.decision)}
                </span>
              )}
              <span
                className="min-w-0 flex-1 truncate"
                title={
                  entry.kind === 'commit' && entry.author
                    ? `${entry.title} — ${entry.author}`
                    : entry.title
                }
              >
                {entry.title}
              </span>
              <span className="w-8 shrink-0 text-right text-[11px] text-muted-foreground tabular-nums">
                {formatShortTimeAgo(entry.at, now)}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}
