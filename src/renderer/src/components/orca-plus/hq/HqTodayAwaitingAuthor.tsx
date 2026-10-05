// Custom build (hq-task-questions): tasks whose author was asked. A comment from anyone but the owner
// after the questions went out returns the task to «New tasks».
import { useEffect, useEffectEvent } from 'react'
import type { ClickUpComment, ClickUpTaskSummary } from '../../../../../shared/clickup-types'
import { hqAuthorAnswered, type HqTriageDecisions } from '../../../../../shared/hq-triage'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { formatShortTimeAgo } from '@/lib/short-time-ago'
import { ColumnHeader } from './hq-waiting-parts'

export function HqTodayAwaitingAuthor({
  tasks,
  decisions,
  ownerId,
  now,
  readComments,
  onAnswered,
  onBack
}: {
  tasks: ClickUpTaskSummary[]
  decisions: HqTriageDecisions
  ownerId: string | null
  now: number
  readComments: (taskId: string) => Promise<ClickUpComment[]>
  /** The author answered: the task goes back to «New tasks». */
  onAnswered: (taskIds: string[]) => void
  onBack: (taskId: string) => void
}): React.JSX.Element | null {
  const key = tasks.map((task) => task.id).join(',')
  const answeredAmong = useEffectEvent(async (taskIds: string[]): Promise<string[]> => {
    const answered = await Promise.all(
      taskIds.map(async (taskId) => {
        const comments = await readComments(taskId).catch((): ClickUpComment[] => [])
        return hqAuthorAnswered(comments, decisions[taskId]?.at ?? 0, ownerId) ? taskId : null
      })
    )
    return answered.filter((taskId): taskId is string => taskId !== null)
  })
  const reportAnswered = useEffectEvent((taskIds: string[]) => onAnswered(taskIds))
  // Why: one comment read per asked task each time the set changes, not on every settings write.
  useEffect(() => {
    if (!key) {
      return
    }
    let alive = true
    void answeredAmong(key.split(',')).then((ids) => {
      if (alive && ids.length > 0) {
        reportAnswered(ids)
      }
    })
    return () => {
      alive = false
    }
  }, [key])
  if (tasks.length === 0) {
    return null
  }
  const title = translate('auto.hq.triage.awaitingAuthor', 'Waiting on the author')
  return (
    <section className="flex flex-col gap-2" aria-label={title}>
      <ColumnHeader title={title} count={tasks.length} />
      <ul className="flex flex-col">
        {tasks.map((task) => (
          <li key={task.id} className="flex items-center gap-2 px-2 py-1">
            <span className="w-20 shrink-0 truncate font-mono text-[11px] text-muted-foreground">
              {task.identifier}
            </span>
            <span className="min-w-0 flex-1 truncate text-[13px]">{task.title}</span>
            <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
              {translate('auto.hq.triage.askedAgo', 'asked {{value0}}', {
                value0: formatShortTimeAgo(decisions[task.id]?.at ?? now, now)
              })}
            </span>
            <Button type="button" variant="ghost" size="xs" onClick={() => onBack(task.id)}>
              {translate('auto.hq.triage.backToNew', 'Back to new')}
            </Button>
          </li>
        ))}
      </ul>
    </section>
  )
}
