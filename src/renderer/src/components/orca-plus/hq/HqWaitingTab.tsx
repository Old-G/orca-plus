// Custom build (hq): the HQ «Waiting» tab — who waits on me, whom I wait on, and what was decided.
import type { PulseWaitingDirection } from '../../../../../shared/pulse-types'
import { useNow } from '@/hooks/use-now'
import { translate } from '@/i18n/i18n'
import { formatShortTimeAgo } from '@/lib/short-time-ago'
import type { HqDecision, HqPerson, HqWaiting } from './hq-pulse-snapshot'
import { ColumnHeader, QuickAdd, WaitingCard, decisionLabel } from './hq-waiting-parts'
import { useHqPulse } from './use-hq-pulse'

const AGE_TICK_MS = 60_000

function columnTitle(direction: PulseWaitingDirection): string {
  return direction === 'on-me'
    ? translate('auto.hq.waiting.onMe', 'Waiting on me')
    : translate('auto.hq.waiting.onThem', "I'm waiting on")
}

function emptyText(direction: PulseWaitingDirection): string {
  return direction === 'on-me'
    ? translate('auto.hq.waiting.emptyOnMe', 'Nobody is waiting on you.')
    : translate('auto.hq.waiting.emptyOnThem', "You're not waiting on anyone.")
}

function WaitingColumn({
  direction,
  waitings,
  people,
  now
}: {
  direction: PulseWaitingDirection
  waitings: readonly HqWaiting[]
  people: readonly HqPerson[]
  now: number
}): React.JSX.Element {
  const names = new Map(people.map((person) => [person.id, person.name]))
  return (
    <section className="flex min-h-0 flex-col gap-3" aria-label={columnTitle(direction)}>
      <ColumnHeader title={columnTitle(direction)} count={waitings.length} />
      <QuickAdd direction={direction} people={people} />
      {waitings.length === 0 ? (
        <p className="text-xs text-muted-foreground">{emptyText(direction)}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {waitings.map((waiting) => (
            <WaitingCard
              key={waiting.id}
              waiting={waiting}
              personName={waiting.personId ? (names.get(waiting.personId) ?? null) : null}
              now={now}
            />
          ))}
        </ul>
      )}
    </section>
  )
}

function DecisionsColumn({
  decisions,
  now
}: {
  decisions: readonly HqDecision[]
  now: number
}): React.JSX.Element {
  const title = translate('auto.hq.waiting.decisions', 'Recent decisions')
  return (
    <section className="flex min-h-0 flex-col gap-3" aria-label={title}>
      <ColumnHeader title={title} count={decisions.length} />
      {decisions.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {translate('auto.hq.waiting.emptyDecisions', 'No decisions yet.')}
        </p>
      ) : (
        <ul className="flex flex-col">
          {decisions.map((decision) => (
            <li
              key={decision.id}
              className="flex items-baseline gap-2 border-b border-border py-1.5 text-[13px] last:border-b-0"
            >
              <span className="min-w-0 flex-1 truncate" title={decision.title}>
                {decision.title}
              </span>
              <span
                data-outcome={decision.outcome ?? 'decision'}
                className="shrink-0 text-xs text-muted-foreground data-[outcome=rejected]:text-destructive"
              >
                {decisionLabel(decision)}
              </span>
              <span className="w-8 shrink-0 text-right text-[11px] text-muted-foreground tabular-nums">
                {formatShortTimeAgo(decision.decidedAt, now)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export function HqWaitingTab(): React.JSX.Element {
  const state = useHqPulse()
  // Why: one tick for every age label on the tab.
  const now = useNow(AGE_TICK_MS)
  if (state.status !== 'ready') {
    return (
      <p className="p-4 text-sm text-muted-foreground">
        {state.status === 'loading'
          ? translate('auto.hq.waiting.loading', 'Loading…')
          : translate('auto.hq.waiting.loadFailed', "Couldn't read waitings: {{value0}}", {
              value0: state.message
            })}
      </p>
    )
  }
  const { people, waitings, decisions } = state.pulse
  return (
    <div className="scrollbar-sleek grid h-full min-h-0 grid-cols-1 content-start gap-6 overflow-y-auto p-4 md:grid-cols-3">
      <WaitingColumn
        direction="on-me"
        waitings={waitings.filter((waiting) => waiting.direction === 'on-me')}
        people={people}
        now={now}
      />
      <WaitingColumn
        direction="on-them"
        waitings={waitings.filter((waiting) => waiting.direction === 'on-them')}
        people={people}
        now={now}
      />
      <DecisionsColumn decisions={decisions} now={now} />
    </div>
  )
}
