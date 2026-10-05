// Custom build (hq-closing): the «Today» tab's «Ready for you» — taken tasks whose agent finished,
// each taken the rest of the way by the owner's clicks: MR, merge, ClickUp comment, hours, «check».
import type { ClickUpTaskSummary } from '../../../../../shared/clickup-types'
import type { DashboardCard } from '../../../../../shared/dashboard-snapshot'
import type { HqAutonomyLevel } from '../../../../../shared/hq-autonomy'
import { findCheckStatus, readyHqTasks } from '../../../../../shared/hq-closing'
import type { HqTriageDecisions } from '../../../../../shared/hq-triage'
import type { TaskSourceContext } from '../../../../../shared/task-source-context'
import { translate } from '@/i18n/i18n'
import {
  clickUpAddTaskComment,
  clickUpListStatuses,
  clickUpUpdateTaskStatus,
  clickUpUpdateTaskTimeEstimate
} from '@/runtime/runtime-clickup-client'
import { readHqAgentAnswer } from './hq-agent-answer'
import { sendHqAgentMessage } from './hq-today-actions'
import { patchHqTriageDecision } from './hq-triage-decisions'
import { HqTodayReadyRow, type HqReadyRowActions } from './HqTodayReadyRow'
import { ColumnHeader } from './hq-waiting-parts'

function failureText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function rowActions(
  task: ClickUpTaskSummary,
  agent: DashboardCard | null,
  sourceContext: TaskSourceContext | null
): HqReadyRowActions {
  return {
    tell: async (text) => {
      if (!agent) {
        return translate('auto.hq.today.agentGone', 'This agent is no longer open.')
      }
      const result = await sendHqAgentMessage(agent, text)
      return result.ok ? null : result.message
    },
    readAnswer: () => (agent ? readHqAgentAnswer(agent) : Promise.resolve(null)),
    comment: async (text) => {
      const result = await clickUpAddTaskComment(sourceContext, task.id, text).catch(
        (error: unknown) => ({ ok: false as const, error: failureText(error) })
      )
      if (!result.ok) {
        return result.error
      }
      await patchHqTriageDecision(task.id, { commentedAt: Date.now() })
      return null
    },
    setHours: async (hours) => {
      const result = await clickUpUpdateTaskTimeEstimate(sourceContext, task.id, hours).catch(
        (error: unknown) => ({ ok: false as const, error: failureText(error) })
      )
      if (!result.ok) {
        return result.error
      }
      await patchHqTriageDecision(task.id, { hours })
      return null
    },
    setCheck: async () => {
      try {
        const status = task.listId
          ? findCheckStatus(await clickUpListStatuses(sourceContext, task.listId))
          : null
        if (!status) {
          return translate(
            'auto.hq.ready.noCheck',
            'The task list has no «check» status — move it by hand.'
          )
        }
        const result = await clickUpUpdateTaskStatus(sourceContext, task.id, status.name)
        if (!result.ok) {
          return result.error
        }
        await patchHqTriageDecision(task.id, { decision: 'closed', at: Date.now() })
        return null
      } catch (error) {
        return failureText(error)
      }
    },
    stamp: (patch) => void patchHqTriageDecision(task.id, patch)
  }
}

export function HqTodayReady({
  tasks,
  decisions,
  cards,
  sourceContext,
  levelOf
}: {
  tasks: readonly ClickUpTaskSummary[]
  decisions: HqTriageDecisions
  cards: readonly DashboardCard[]
  sourceContext: TaskSourceContext | null
  levelOf: (repoId: string) => HqAutonomyLevel
}): React.JSX.Element | null {
  const ready = readyHqTasks(tasks, decisions, cards)
  if (ready.length === 0) {
    return null
  }
  const title = translate('auto.hq.ready.title', 'Ready for you')
  return (
    <section className="flex flex-col gap-2" aria-label={title}>
      <ColumnHeader title={title} count={ready.length} />
      <ul className="flex flex-col gap-1">
        {ready.map(({ task, decision, agent }) => (
          <HqTodayReadyRow
            key={task.id}
            task={task}
            decision={decision}
            agent={agent}
            level={decision.repoId ? levelOf(decision.repoId) : 1}
            actions={rowActions(task, agent, sourceContext)}
          />
        ))}
      </ul>
    </section>
  )
}
