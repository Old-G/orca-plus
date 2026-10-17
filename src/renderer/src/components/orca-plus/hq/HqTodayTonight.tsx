// Custom build (hq-night-shift): the tasks queued «Tonight», waiting for the night shift — with a way to
// start one now or take it off the queue.
import { Moon } from 'lucide-react'
import type { ClickUpTaskSummary } from '../../../../../shared/clickup-types'
import type { Repo } from '../../../../../shared/repo-types'
import type { HqTriageDecisions } from '../../../../../shared/hq-triage'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { ColumnHeader } from './hq-waiting-parts'

export function HqTodayTonight({
  tasks,
  decisions,
  repos,
  startHour,
  onStartNow,
  onCancel
}: {
  tasks: readonly ClickUpTaskSummary[]
  decisions: HqTriageDecisions
  repos: readonly Repo[]
  startHour: number
  onStartNow: (task: ClickUpTaskSummary, repoIds: string[]) => void
  onCancel: (taskId: string) => void
}): React.JSX.Element | null {
  const queued = tasks.filter((task) => decisions[task.id]?.decision === 'night')
  if (queued.length === 0) {
    return null
  }
  const title = translate('auto.hq.night.title', 'Tonight')
  const projectNames = (ids: readonly string[]): string =>
    ids.map((id) => repos.find((repo) => repo.id === id)?.displayName ?? id).join(', ')
  return (
    <section className="flex flex-col gap-2" aria-label={title}>
      <ColumnHeader title={title} count={queued.length} />
      <p className="text-xs text-muted-foreground">
        {translate(
          'auto.hq.night.hint',
          'Starts at {{value0}}:00 while the Mac is awake; agents stay in their worktrees and nothing leaves the Mac.',
          { value0: startHour }
        )}
      </p>
      <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
        {queued.map((task) => {
          const repoIds = decisions[task.id]?.repoIds ?? []
          return (
            <li key={task.id} className="flex items-center gap-2.5 px-3 py-2.5">
              <Moon className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">{task.title}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {[task.identifier, projectNames(repoIds)].filter(Boolean).join(' · ')}
                </span>
                {decisions[task.id]?.nightSkipped === 'changed' ? (
                  <span className="block text-xs text-status-warning">
                    {translate(
                      'auto.hq.night.changed',
                      'Not started: the task changed after you queued it. Read it, then Start now or Cancel.'
                    )}
                  </span>
                ) : null}
              </span>
              <Button
                type="button"
                size="xs"
                variant="outline"
                onClick={() => onStartNow(task, repoIds)}
              >
                {translate('auto.hq.night.startNow', 'Start now')}
              </Button>
              <Button type="button" size="xs" variant="ghost" onClick={() => onCancel(task.id)}>
                {translate('auto.hq.night.cancel', 'Cancel')}
              </Button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
