// Custom build (hq): the HQ «Today» tab — the morning briefing kept live: a command line to HQ's
// Claude, agents and waitings that need a move, ClickUp deadlines, open reviews and limits.
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { useNow } from '@/hooks/use-now'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { useLiveDashboardSnapshot } from '../../dashboard/useLiveDashboardSnapshot'
import { findHqWorktreeId, launchHqCommand } from './hq-today-actions'
import { HqTodayAgents, HqTodayWaitings } from './HqTodayPeople'
import { HqTodayReviewRequests } from './HqTodayReviewRequests'
import { HqTodayDeadlines, HqTodayLimits, HqTodayReviews } from './HqTodayWork'
import { useHqPulse } from './use-hq-pulse'

const AGE_TICK_MS = 60_000

function CommandBox({ hqWorktreeId }: { hqWorktreeId: string | null }): React.JSX.Element {
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const submit = (): void => {
    if (!hqWorktreeId || !text.trim()) {
      return
    }
    const result = launchHqCommand(hqWorktreeId, text)
    if (result.ok) {
      setText('')
      setError(null)
    } else {
      setError(result.message)
    }
  }
  return (
    <form
      className="flex flex-col gap-1.5"
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
    >
      <div className="flex items-end gap-2">
        <Textarea
          className="min-h-9 flex-1 resize-none"
          rows={1}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault()
              submit()
            }
          }}
          placeholder={translate(
            'auto.hq.today.commandPlaceholder',
            'Give HQ a command — Claude starts in the HQ workspace with it…'
          )}
          aria-label={translate('auto.hq.today.command', 'Command')}
          disabled={!hqWorktreeId}
        />
        <Button type="submit" disabled={!hqWorktreeId || !text.trim()}>
          {translate('auto.hq.today.run', 'Run')}
        </Button>
      </div>
      {hqWorktreeId ? null : (
        <p className="text-xs text-muted-foreground">
          {translate(
            'auto.hq.today.addHqProject',
            'Add the HQ folder as a project in Orca to run reminders and commands.'
          )}
        </p>
      )}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </form>
  )
}

export function HqTodayTab(): React.JSX.Element {
  const snapshot = useLiveDashboardSnapshot()
  const pulse = useHqPulse()
  const now = useNow(AGE_TICK_MS)
  const hqWorktreeId = useAppStore((s) =>
    findHqWorktreeId(s.settings?.hqPath, s.repos, s.worktreesByRepo)
  )
  return (
    <div className="scrollbar-sleek flex h-full min-h-0 flex-col gap-6 overflow-y-auto p-4">
      <CommandBox hqWorktreeId={hqWorktreeId} />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-6">
          <HqTodayAgents cards={snapshot.cards} now={now} />
          {pulse.status === 'ready' ? (
            <HqTodayWaitings
              waitings={pulse.pulse.waitings}
              people={pulse.pulse.people}
              hqWorktreeId={hqWorktreeId}
              now={now}
            />
          ) : (
            <p className="text-xs text-muted-foreground">
              {pulse.status === 'loading'
                ? translate('auto.hq.waiting.loading', 'Loading…')
                : translate('auto.hq.waiting.loadFailed', "Couldn't read waitings: {{value0}}", {
                    value0: pulse.message
                  })}
            </p>
          )}
        </div>
        <div className="flex min-w-0 flex-col gap-6">
          <HqTodayDeadlines now={now} />
          <HqTodayReviewRequests now={now} />
          <HqTodayReviews workspaces={snapshot.workspaces ?? []} />
          <HqTodayLimits />
        </div>
      </div>
    </div>
  )
}
