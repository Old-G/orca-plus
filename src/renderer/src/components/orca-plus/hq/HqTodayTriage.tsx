// Custom build (hq-triage): the «Today» tab's «New tasks» — the owner's fresh ClickUp tasks, each with
// a suggested project. Take starts Claude in a new worktree there; Questions asks the author first.
// Nothing starts or is sent on its own.
import { useState } from 'react'
import type { ClickUpTaskSummary } from '../../../../../shared/clickup-types'
import type { DashboardCard } from '../../../../../shared/dashboard-snapshot'
import type { HqAutonomyLevel } from '../../../../../shared/hq-autonomy'
import { isGitRepoKind } from '../../../../../shared/repo-kind'
import type { Repo } from '../../../../../shared/repo-types'
import type { TaskSourceContext } from '../../../../../shared/task-source-context'
import {
  hqTasksAwaitingAuthor,
  pendingHqTriageTasks,
  suggestHqTriageProject,
  type HqTaskQuestionsResult,
  type HqTriageDecision
} from '../../../../../shared/hq-triage'
import { ClickUpTaskSheet } from '@/components/task-page/clickup/TaskSheet'
import { translate } from '@/i18n/i18n'
import {
  buildClickUpLinkedWorkItem,
  getClickUpTaskWorkspaceSeed
} from '@/lib/clickup-linked-work-item'
import {
  clickUpAddTaskComment,
  clickUpGetTask,
  clickUpTaskComments
} from '@/runtime/runtime-clickup-client'
import { useAppStore } from '@/store'
import { updateHqTriageDecisions } from './hq-triage-decisions'
import { reportHqTake, runHqTake } from './hq-triage-run-take'
import { HqTodayTonight } from './HqTodayTonight'
import { HQ_NIGHT_SHIFT_DEFAULT_HOUR } from '../../../../../shared/hq-night-shift'
import { HqTodayAwaitingAuthor } from './HqTodayAwaitingAuthor'
import { HqTodayReady } from './HqTodayReady'
import { HqTodayTriageRow } from './HqTodayTriageRow'
import { ColumnHeader } from './hq-waiting-parts'
import { useHqClickUpConnection, useHqMyClickUpTasks } from './use-hq-project-clickup'
import { useHqProjectPages } from './use-hq-project-pages'

const TODAY_SOURCE_PROJECT = 'hq-today'
const DEFAULT_LEVEL: HqAutonomyLevel = 1
const NO_DECISIONS = {}
const NO_REPOS: Repo[] = []

function triageDecision(decision: HqTriageDecision['decision'], repoId?: string): HqTriageDecision {
  return { decision, at: Date.now(), ...(repoId ? { repoId } : {}) }
}

export function HqTodayTriage({
  now,
  cards,
  focusTaskId
}: {
  now: number
  cards: readonly DashboardCard[]
  /** Custom build (hq-today-inbox): only this task, as Today's right pane opens one item. */
  focusTaskId?: string
}): React.JSX.Element | null {
  const connection = useHqClickUpConnection(TODAY_SOURCE_PROJECT)
  const tasks = useHqMyClickUpTasks(connection)
  const pages = useHqProjectPages()
  const decisions = useAppStore((s) => s.settings?.hqTriageDecisions ?? NO_DECISIONS)
  const bindings = useAppStore((s) => s.settings?.hqProjectClickUpLists)
  const allRepos = useAppStore((s) => s.repos ?? NO_REPOS)
  const openModal = useAppStore((s) => s.openModal)
  // Why: «Not now» lasts until HQ reopens, so it stays out of settings.
  const [snoozed, setSnoozed] = useState<ReadonlySet<string>>(() => new Set())
  const [busyId, setBusyId] = useState<string | null>(null)
  const [selected, setSelected] = useState<ClickUpTaskSummary | null>(null)
  const sourceContext: TaskSourceContext | null =
    connection.status === 'ready' ? connection.sourceContext : null
  const repos = allRepos.filter(isGitRepoKind)
  const ownerId = useAppStore((s) => s.clickUpStatus.viewer?.id ?? null)
  const nightHour = useAppStore((s) => s.settings?.hqNightShiftHour ?? HQ_NIGHT_SHIFT_DEFAULT_HOUR)
  const allTasks = tasks.state.status === 'ready' ? tasks.state.tasks : []
  const awaiting = hqTasksAwaitingAuthor(allTasks, decisions)
  const pending = pendingHqTriageTasks(allTasks, decisions, snoozed).filter(
    (task) => !focusTaskId || task.id === focusTaskId
  )
  const title = translate('auto.hq.triage.title', 'New tasks')

  const decide = (
    taskId: string,
    decision: HqTriageDecision['decision'],
    repoId?: string
  ): Promise<void> =>
    updateHqTriageDecisions((current) => ({
      ...current,
      [taskId]: triageDecision(decision, repoId)
    }))

  const forget = (taskIds: string[]): Promise<void> =>
    updateHqTriageDecisions((current) => {
      const next = { ...current }
      for (const taskId of taskIds) {
        delete next[taskId]
      }
      return next
    })

  const draftQuestions = async (task: ClickUpTaskSummary): Promise<HqTaskQuestionsResult> => {
    const full = await clickUpGetTask(sourceContext, task.id).catch(() => null)
    return window.api.hqProjects
      .draftTaskQuestions({
        identifier: task.identifier,
        title: task.title,
        description: full?.description ?? ''
      })
      .catch((error: unknown) => ({ ok: false, error: String(error) }))
  }

  const sendQuestions = async (task: ClickUpTaskSummary, text: string): Promise<string | null> => {
    const result = await clickUpAddTaskComment(sourceContext, task.id, text).catch(
      (error: unknown) => ({ ok: false as const, error: String(error) })
    )
    if (!result.ok) {
      return result.error
    }
    await decide(task.id, 'asked')
    return null
  }

  const openComposer = (task: ClickUpTaskSummary, repoId: string | null): void =>
    openModal('new-workspace-composer', {
      linkedWorkItem: buildClickUpLinkedWorkItem(task, null),
      taskSourceContext: sourceContext,
      prefilledName: getClickUpTaskWorkspaceSeed(task),
      ...(repoId ? { initialRepoId: repoId } : {}),
      telemetrySource: 'sidebar'
    })

  const levelOf = (repoId: string): HqAutonomyLevel =>
    (pages.status === 'ready' ? pages.pages.find((p) => p.repoId === repoId)?.autonomy : null) ??
    DEFAULT_LEVEL

  const take = async (task: ClickUpTaskSummary, repoIds: string[]): Promise<void> => {
    setBusyId(task.id)
    try {
      reportHqTake(
        await runHqTake(task, repoIds, { sourceContext, repos, levelOf, openComposer }),
        task
      )
    } finally {
      setBusyId(null)
    }
  }

  // Custom build (hq-night-shift): the night shift starts it; until then it waits under «Tonight».
  const tonight = (task: ClickUpTaskSummary, repoIds: string[]): Promise<void> =>
    updateHqTriageDecisions((current) => ({
      ...current,
      [task.id]: { decision: 'night', at: Date.now(), repoIds, queuedUpdatedAt: task.updatedAt }
    }))

  if (connection.status === 'disconnected') {
    // Why: the deadlines block below already offers to connect ClickUp.
    return null
  }
  let body: React.JSX.Element
  if (tasks.state.status === 'error') {
    body = (
      <p className="text-xs text-destructive">
        {translate('auto.hq.project.tasksFailed', "Couldn't read tasks: {{value0}}", {
          value0: tasks.state.message
        })}
      </p>
    )
  } else if (connection.status === 'checking' || tasks.state.status === 'loading') {
    body = (
      <p className="text-xs text-muted-foreground">
        {translate('auto.hq.waiting.loading', 'Loading…')}
      </p>
    )
  } else if (pending.length === 0) {
    body = (
      <p className="text-xs text-muted-foreground">
        {translate('auto.hq.triage.empty', 'No new tasks.')}
      </p>
    )
  } else {
    body = (
      <ul className="flex flex-col gap-1">
        {pending.map((task) => (
          <HqTodayTriageRow
            key={task.id}
            task={task}
            repos={repos}
            suggested={suggestHqTriageProject(task, bindings)}
            busy={busyId === task.id}
            onOpen={() => setSelected(task)}
            onTake={(repoIds) => void take(task, repoIds)}
            onTonight={(repoIds) => void tonight(task, repoIds)}
            onDraftQuestions={() => draftQuestions(task)}
            onSendQuestions={(text) => sendQuestions(task, text)}
            onSnooze={() => setSnoozed((current) => new Set(current).add(task.id))}
            onHide={() => void decide(task.id, 'hidden')}
          />
        ))}
      </ul>
    )
  }
  return (
    <>
      <HqTodayReady
        tasks={allTasks}
        decisions={decisions}
        cards={cards}
        sourceContext={sourceContext}
        levelOf={levelOf}
        focusTaskId={focusTaskId}
      />
      {focusTaskId ? null : (
        <HqTodayTonight
          tasks={allTasks}
          decisions={decisions}
          repos={repos}
          startHour={nightHour}
          onStartNow={(task, repoIds) => void take(task, repoIds)}
          onCancel={(taskId) => void forget([taskId])}
        />
      )}
      {focusTaskId && pending.length === 0 ? null : (
        <section className="flex flex-col gap-2" aria-label={title}>
          <ColumnHeader title={title} count={pending.length} />
          {body}
          {focusTaskId ? null : (
            <HqTodayAwaitingAuthor
              tasks={awaiting}
              decisions={decisions}
              ownerId={ownerId}
              now={now}
              readComments={(taskId) => clickUpTaskComments(sourceContext, taskId)}
              onAnswered={(taskIds) => void forget(taskIds)}
              onBack={(taskId) => void forget([taskId])}
            />
          )}
          <ClickUpTaskSheet
            summary={selected}
            sourceContext={sourceContext}
            onClose={() => setSelected(null)}
            onUse={(task) => {
              setSelected(null)
              openComposer(task, suggestHqTriageProject(task, bindings))
            }}
            onTaskChanged={tasks.refresh}
          />
        </section>
      )}
    </>
  )
}
