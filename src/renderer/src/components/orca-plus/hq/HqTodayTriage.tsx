// Custom build (hq-triage): the «Today» tab's «New tasks» — the owner's fresh ClickUp tasks, each with
// a suggested project. Take starts Claude in a new worktree there; Questions asks the author first.
// Nothing starts or is sent on its own.
import { useState } from 'react'
import { toast } from 'sonner'
import type { ClickUpTaskSummary } from '../../../../../shared/clickup-types'
import type { HqAutonomyLevel } from '../../../../../shared/hq-autonomy'
import { isGitRepoKind } from '../../../../../shared/repo-kind'
import type { Repo } from '../../../../../shared/repo-types'
import type { TaskSourceContext } from '../../../../../shared/task-source-context'
import {
  HQ_TAKE_EFFORT,
  hqTasksAwaitingAuthor,
  withHqTakeEffort,
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
import { launchWorkItemDirect } from '@/lib/launch-work-item-direct'
import {
  clickUpAddTaskComment,
  clickUpGetTask,
  clickUpListStatuses,
  clickUpTaskComments,
  clickUpUpdateTaskStatus
} from '@/runtime/runtime-clickup-client'
import { useAppStore } from '@/store'
import { findHqWorktreeId, launchHqCommand } from './hq-today-actions'
import {
  buildHqCoordinatorWorkItem,
  buildHqTriageWorkItem,
  takeHqTriageTask,
  type HqTriageTakeResult
} from './hq-triage-take'
import { HqTodayAwaitingAuthor } from './HqTodayAwaitingAuthor'
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

function reportTake(result: HqTriageTakeResult, task: ClickUpTaskSummary): void {
  if (!result.launched) {
    return
  }
  if (result.status.kind === 'missing') {
    toast.warning(
      translate(
        'auto.hq.triage.noInProcess',
        '{{value0}}: Claude started, but its ClickUp list has no «in process» status — move it by hand.',
        { value0: task.identifier }
      )
    )
  } else if (result.status.kind === 'failed') {
    toast.warning(
      translate(
        'auto.hq.triage.statusFailed',
        '{{value0}}: Claude started, but ClickUp kept the old status: {{value1}}',
        { value0: task.identifier, value1: result.status.message }
      )
    )
  }
}

export function HqTodayTriage({ now }: { now: number }): React.JSX.Element | null {
  const connection = useHqClickUpConnection(TODAY_SOURCE_PROJECT)
  const tasks = useHqMyClickUpTasks(connection)
  const pages = useHqProjectPages()
  const decisions = useAppStore((s) => s.settings?.hqTriageDecisions ?? NO_DECISIONS)
  const bindings = useAppStore((s) => s.settings?.hqProjectClickUpLists)
  const allRepos = useAppStore((s) => s.repos ?? NO_REPOS)
  const updateSettings = useAppStore((s) => s.updateSettings)
  const openModal = useAppStore((s) => s.openModal)
  // Why: «Not now» lasts until HQ reopens, so it stays out of settings.
  const [snoozed, setSnoozed] = useState<ReadonlySet<string>>(() => new Set())
  const [busyId, setBusyId] = useState<string | null>(null)
  const [selected, setSelected] = useState<ClickUpTaskSummary | null>(null)
  const sourceContext: TaskSourceContext | null =
    connection.status === 'ready' ? connection.sourceContext : null
  const repos = allRepos.filter(isGitRepoKind)
  const ownerId = useAppStore((s) => s.clickUpStatus.viewer?.id ?? null)
  const allTasks = tasks.state.status === 'ready' ? tasks.state.tasks : []
  const awaiting = hqTasksAwaitingAuthor(allTasks, decisions)
  const pending = pendingHqTriageTasks(allTasks, decisions, snoozed)
  const title = translate('auto.hq.triage.title', 'New tasks')

  const decide = (
    taskId: string,
    decision: HqTriageDecision['decision'],
    repoId?: string
  ): Promise<void> =>
    updateSettings({
      hqTriageDecisions: {
        ...useAppStore.getState().settings?.hqTriageDecisions,
        [taskId]: triageDecision(decision, repoId)
      }
    })

  const forget = (taskIds: string[]): Promise<void> => {
    const next = { ...useAppStore.getState().settings?.hqTriageDecisions }
    for (const taskId of taskIds) {
      delete next[taskId]
    }
    return updateSettings({ hqTriageDecisions: next })
  }

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
    const chosen = repoIds.flatMap((id) => repos.filter((repo) => repo.id === id))
    const [main] = chosen
    if (!main) {
      return
    }
    const sessionOptions = withHqTakeEffort(
      useAppStore.getState().settings?.nativeChatSessionOptions
    )
    const coordinate = chosen.length > 1
    setBusyId(task.id)
    try {
      const result = await takeHqTriageTask(
        task,
        (full) =>
          coordinate
            ? buildHqCoordinatorWorkItem(task, full, {
                projects: chosen.map((repo) => ({
                  name: repo.displayName,
                  path: repo.path,
                  level: levelOf(repo.id)
                })),
                model: sessionOptions.claude?.model ?? 'opus',
                effort: HQ_TAKE_EFFORT
              })
            : buildHqTriageWorkItem(task, full, {
                name: main.displayName,
                level: levelOf(main.id)
              }),
        {
          getTask: (taskId) => clickUpGetTask(sourceContext, taskId),
          launch: async (item) => {
            if (!coordinate) {
              return launchWorkItemDirect({
                item,
                repoId: main.id,
                agentOverride: 'claude',
                promptDelivery: 'submit-after-ready',
                launchSource: 'task_page',
                telemetrySource: 'sidebar',
                nativeChatSessionOptions: sessionOptions,
                openModalFallback: () => openComposer(task, main.id)
              })
            }
            const state = useAppStore.getState()
            const hqWorktreeId = findHqWorktreeId(
              state.settings?.hqPath,
              state.repos,
              state.worktreesByRepo
            )
            const launched = hqWorktreeId
              ? launchHqCommand(hqWorktreeId, item.pasteContent ?? '')
              : {
                  ok: false as const,
                  message: translate(
                    'auto.hq.today.addHqProject',
                    'Add the HQ folder as a project in Orca to run reminders and commands.'
                  )
                }
            if (!launched.ok) {
              toast.error(launched.message)
            }
            return launched.ok
          },
          listStatuses: (listId) => clickUpListStatuses(sourceContext, listId),
          setStatus: (taskId, status) => clickUpUpdateTaskStatus(sourceContext, taskId, status),
          remember: () => decide(task.id, 'taken', main.id)
        }
      )
      reportTake(result, task)
    } finally {
      setBusyId(null)
    }
  }

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
    <section className="flex flex-col gap-2" aria-label={title}>
      <ColumnHeader title={title} count={pending.length} />
      {body}
      <HqTodayAwaitingAuthor
        tasks={awaiting}
        decisions={decisions}
        ownerId={ownerId}
        now={now}
        readComments={(taskId) => clickUpTaskComments(sourceContext, taskId)}
        onAnswered={(taskIds) => void forget(taskIds)}
        onBack={(taskId) => void forget([taskId])}
      />
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
  )
}
