// Custom build (hq): the «Today» tab's people side — agents that wait on the user or finished
// unread, and the open waitings, each with the button that moves it on.
import { useState } from 'react'
import type { DashboardCard } from '../../../../../shared/dashboard-snapshot'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { formatShortTimeAgo } from '@/lib/short-time-ago'
import { revealDashboardAgent } from '../../dashboard/reveal-dashboard-agent'
import type { HqPerson, HqWaiting } from './hq-pulse-snapshot'
import { buildHqTodayAgents, hqReminderPrompt, sortHqTodayWaitings } from './hq-today'
import { launchHqCommand, sendHqAgentMessage, type HqActionResult } from './hq-today-actions'
import { ColumnHeader, WaitingCard } from './hq-waiting-parts'

function reveal(card: DashboardCard): void {
  revealDashboardAgent({
    repoId: card.repoId,
    worktreeId: card.worktreeId,
    executionHostId: card.executionHostId,
    tabId: card.tabId,
    leafId: card.leafId
  })
}

function AgentButtons({
  card,
  canContinue
}: {
  card: DashboardCard
  canContinue: boolean
}): React.JSX.Element {
  const [result, setResult] = useState<HqActionResult | null>(null)
  const [busy, setBusy] = useState(false)
  const nudge = (): void => {
    setBusy(true)
    sendHqAgentMessage(card, translate('auto.hq.today.continueText', 'Continue'))
      .then(setResult)
      .finally(() => setBusy(false))
  }
  return (
    <>
      {result ? (
        <span
          data-failed={!result.ok}
          className="min-w-0 truncate text-xs text-muted-foreground data-[failed=true]:text-destructive"
        >
          {result.ok ? translate('auto.hq.today.sent', 'Sent.') : result.message}
        </span>
      ) : null}
      {canContinue ? (
        <Button
          type="button"
          size="xs"
          variant="ghost"
          disabled={busy || result?.ok === true}
          onClick={nudge}
        >
          {translate('auto.hq.today.continue', 'Continue')}
        </Button>
      ) : null}
      <Button type="button" size="xs" variant="secondary" onClick={() => reveal(card)}>
        {translate('auto.hq.project.open', 'Open')}
      </Button>
    </>
  )
}

function title(card: DashboardCard): string {
  return card.conversationName || card.task || card.agentType
}

/** An agent waiting on the user: what it asks, in full. */
function WaitingAgentCard({ card, now }: { card: DashboardCard; now: number }): React.JSX.Element {
  const detail = card.askSummary ?? card.lastAgentMessage
  return (
    <li className="flex flex-col gap-1 rounded-lg border border-border bg-card p-3 text-card-foreground">
      <div className="flex items-baseline gap-2">
        <span className="min-w-0 flex-1 truncate text-sm">{title(card)}</span>
        {card.stateChangedAt ? (
          <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
            {formatShortTimeAgo(card.stateChangedAt, now)}
          </span>
        ) : null}
      </div>
      <span className="truncate text-xs text-muted-foreground">
        {card.repoName} · {card.worktreeName}
      </span>
      {detail ? <p className="line-clamp-3 text-xs text-muted-foreground">{detail}</p> : null}
      <div className="flex items-center justify-end gap-1">
        <AgentButtons card={card} canContinue={false} />
      </div>
    </li>
  )
}

/** A finished agent: one line, its last answer on hover. */
function FinishedAgentRow({ card, now }: { card: DashboardCard; now: number }): React.JSX.Element {
  return (
    <li
      className="flex items-center gap-2 border-b border-border py-1 last:border-b-0"
      title={card.lastAgentMessage}
    >
      <span className="min-w-0 flex-1 truncate text-[13px]">
        {title(card)}
        <span className="ml-2 text-xs text-muted-foreground">
          {card.repoName} · {card.worktreeName}
        </span>
      </span>
      {card.finishedAt ? (
        <span className="w-8 shrink-0 text-right text-[11px] text-muted-foreground tabular-nums">
          {formatShortTimeAgo(card.finishedAt, now)}
        </span>
      ) : null}
      <AgentButtons card={card} canContinue />
    </li>
  )
}

const FINISHED_SHOWN = 5

export function HqTodayAgents({
  cards,
  now
}: {
  cards: readonly DashboardCard[]
  now: number
}): React.JSX.Element {
  const agents = buildHqTodayAgents(cards)
  const [showAll, setShowAll] = useState(false)
  const heading = translate('auto.hq.project.agents', 'Agents')
  const finished = showAll ? agents.finished : agents.finished.slice(0, FINISHED_SHOWN)
  const hidden = agents.finished.length - finished.length
  return (
    <section className="flex flex-col gap-2" aria-label={heading}>
      <ColumnHeader title={heading} count={agents.needYou.length} />
      {agents.working > 0 ? (
        <p className="text-xs text-muted-foreground">
          {translate('auto.hq.today.working', '{{value0}} working now.', {
            value0: String(agents.working)
          })}
        </p>
      ) : null}
      {agents.needYou.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {translate('auto.hq.today.noAgents', 'No agent is waiting on you.')}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {agents.needYou.map((card) => (
            <WaitingAgentCard key={card.paneKey} card={card} now={now} />
          ))}
        </ul>
      )}
      {agents.finished.length > 0 ? (
        <div className="flex flex-col gap-1">
          <h3 className="text-xs text-muted-foreground">
            {translate('auto.hq.today.finished', 'Finished, not read')} · {agents.finished.length}
          </h3>
          <ul className="flex flex-col">
            {finished.map((card) => (
              <FinishedAgentRow key={card.paneKey} card={card} now={now} />
            ))}
          </ul>
          {hidden > 0 ? (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              className="self-start"
              onClick={() => setShowAll(true)}
            >
              {translate('auto.hq.today.showMore', 'Show {{value0}} more', {
                value0: String(hidden)
              })}
            </Button>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}

function RemindButton({
  waiting,
  personName,
  hqWorktreeId
}: {
  waiting: HqWaiting
  personName: string | null
  hqWorktreeId: string | null
}): React.JSX.Element {
  const [error, setError] = useState<string | null>(null)
  return (
    <>
      {error ? (
        <span className="min-w-0 flex-1 truncate text-xs text-destructive">{error}</span>
      ) : null}
      <Button
        type="button"
        size="xs"
        variant="ghost"
        disabled={!hqWorktreeId}
        title={
          hqWorktreeId
            ? undefined
            : translate(
                'auto.hq.today.addHqProject',
                'Add the HQ folder as a project in Orca to run reminders and commands.'
              )
        }
        onClick={() => {
          if (hqWorktreeId) {
            const result = launchHqCommand(
              hqWorktreeId,
              hqReminderPrompt(personName, waiting.title)
            )
            setError(result.ok ? null : result.message)
          }
        }}
      >
        {translate('auto.hq.today.remind', 'Remind')}
      </Button>
    </>
  )
}

export function HqTodayWaitings({
  waitings,
  people,
  hqWorktreeId,
  now
}: {
  waitings: readonly HqWaiting[]
  people: readonly HqPerson[]
  hqWorktreeId: string | null
  now: number
}): React.JSX.Element {
  const names = new Map(people.map((person) => [person.id, person.name]))
  const title = translate('auto.hq.project.waitings', 'Waitings')
  const groups = [
    {
      direction: 'on-me' as const,
      label: translate('auto.hq.waiting.onMe', 'Waiting on me'),
      list: sortHqTodayWaitings(waitings.filter((waiting) => waiting.direction === 'on-me'))
    },
    {
      direction: 'on-them' as const,
      label: translate('auto.hq.waiting.onThem', "I'm waiting on"),
      list: sortHqTodayWaitings(waitings.filter((waiting) => waiting.direction === 'on-them'))
    }
  ]
  return (
    <section className="flex flex-col gap-3" aria-label={title}>
      <ColumnHeader title={title} count={waitings.length} />
      {waitings.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {translate('auto.hq.today.noWaitings', 'Nothing is waiting.')}
        </p>
      ) : null}
      {groups.map((group) =>
        group.list.length > 0 ? (
          <div key={group.direction} className="flex flex-col gap-2">
            <h3 className="text-xs text-muted-foreground">
              {group.label} · {group.list.length}
            </h3>
            <ul className="flex flex-col gap-2">
              {group.list.map((waiting) => {
                const personName = waiting.personId ? (names.get(waiting.personId) ?? null) : null
                return (
                  <WaitingCard
                    key={waiting.id}
                    waiting={waiting}
                    personName={personName}
                    now={now}
                    action={
                      group.direction === 'on-them' ? (
                        <RemindButton
                          waiting={waiting}
                          personName={personName}
                          hqWorktreeId={hqWorktreeId}
                        />
                      ) : undefined
                    }
                  />
                )
              })}
            </ul>
          </div>
        ) : null
      )}
    </section>
  )
}
