// Custom build (hq-triage): the «Today» tab's «New tasks» — the owner's fresh ClickUp tasks, each with
// a suggested project. Take starts Claude in a new worktree there; nothing starts on its own.
import { useState } from 'react'
import { toast } from 'sonner'
import type { ClickUpTaskSummary } from '../../../../../shared/clickup-types'
import type { HqAutonomyLevel } from '../../../../../shared/hq-autonomy'
import { isGitRepoKind } from '../../../../../shared/repo-kind'
import type { Repo } from '../../../../../shared/repo-types'
import type { TaskSourceContext } from '../../../../../shared/task-source-context'
import {
  pendingHqTriageTasks,
  suggestHqTriageProject,
  type HqTriageDecision
} from '../../../../../shared/hq-triage'
import { ClickUpTaskSheet } from '@/components/task-page/clickup/TaskSheet'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { translate } from '@/i18n/i18n'
import {
  buildClickUpLinkedWorkItem,
  getClickUpTaskWorkspaceSeed
} from '@/lib/clickup-linked-work-item'
import { launchWorkItemDirect } from '@/lib/launch-work-item-direct'
import {
  clickUpGetTask,
  clickUpListStatuses,
  clickUpUpdateTaskStatus
} from '@/runtime/runtime-clickup-client'
import { useAppStore } from '@/store'
import { takeHqTriageTask, type HqTriageTakeResult } from './hq-triage-take'
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

function TriageRow({
  task,
  repos,
  suggested,
  busy,
  onOpen,
  onTake,
  onSnooze,
  onHide
}: {
  task: ClickUpTaskSummary
  repos: Repo[]
  suggested: string | null
  busy: boolean
  onOpen: () => void
  onTake: (repoId: string) => void
  onSnooze: () => void
  onHide: () => void
}): React.JSX.Element {
  const [repoId, setRepoId] = useState<string | null>(
    suggested && repos.some((repo) => repo.id === suggested) ? suggested : null
  )
  return (
    <li className="flex flex-col gap-1.5 rounded-md px-2 py-1.5 hover:bg-accent/50">
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full items-center gap-2 rounded-sm text-left focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        <span className="w-20 shrink-0 truncate font-mono text-[11px] text-muted-foreground">
          {task.identifier}
        </span>
        <span className="min-w-0 flex-1 truncate text-[13px]">{task.title}</span>
        {task.listName ? (
          <span className="max-w-32 shrink-0 truncate text-[11px] text-muted-foreground">
            {task.listName}
          </span>
        ) : null}
      </button>
      <div className="flex flex-wrap items-center gap-1.5 pl-22">
        <Select value={repoId ?? undefined} onValueChange={setRepoId} disabled={busy}>
          <SelectTrigger
            size="sm"
            className="w-48"
            aria-label={translate('auto.hq.triage.project', 'Project for {{value0}}', {
              value0: task.identifier
            })}
          >
            <SelectValue placeholder={translate('auto.hq.triage.pickProject', 'Pick a project')} />
          </SelectTrigger>
          <SelectContent>
            {repos.map((repo) => (
              <SelectItem key={repo.id} value={repo.id}>
                {repo.displayName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          type="button"
          size="xs"
          disabled={!repoId || busy}
          onClick={() => (repoId ? onTake(repoId) : undefined)}
        >
          {busy
            ? translate('auto.hq.triage.taking', 'Starting…')
            : translate('auto.hq.triage.take', 'Take')}
        </Button>
        <Button type="button" variant="ghost" size="xs" disabled={busy} onClick={onSnooze}>
          {translate('auto.hq.triage.snooze', 'Not now')}
        </Button>
        <Button type="button" variant="ghost" size="xs" disabled={busy} onClick={onHide}>
          {translate('auto.hq.triage.hide', 'Hide')}
        </Button>
      </div>
    </li>
  )
}

export function HqTodayTriage(): React.JSX.Element | null {
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
  const pending = pendingHqTriageTasks(
    tasks.state.status === 'ready' ? tasks.state.tasks : [],
    decisions,
    snoozed
  )
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

  const openComposer = (task: ClickUpTaskSummary, repoId: string | null): void =>
    openModal('new-workspace-composer', {
      linkedWorkItem: buildClickUpLinkedWorkItem(task, null),
      taskSourceContext: sourceContext,
      prefilledName: getClickUpTaskWorkspaceSeed(task),
      ...(repoId ? { initialRepoId: repoId } : {}),
      telemetrySource: 'sidebar'
    })

  const take = async (task: ClickUpTaskSummary, repoId: string): Promise<void> => {
    const repo = repos.find((entry) => entry.id === repoId)
    if (!repo) {
      return
    }
    const page = pages.status === 'ready' ? pages.pages.find((p) => p.repoId === repoId) : null
    setBusyId(task.id)
    try {
      const result = await takeHqTriageTask(
        task,
        { name: repo.displayName, level: page?.autonomy ?? DEFAULT_LEVEL },
        {
          getTask: (taskId) => clickUpGetTask(sourceContext, taskId),
          launch: (item) =>
            launchWorkItemDirect({
              item,
              repoId,
              agentOverride: 'claude',
              promptDelivery: 'submit-after-ready',
              launchSource: 'task_page',
              telemetrySource: 'sidebar',
              openModalFallback: () => openComposer(task, repoId)
            }),
          listStatuses: (listId) => clickUpListStatuses(sourceContext, listId),
          setStatus: (taskId, status) => clickUpUpdateTaskStatus(sourceContext, taskId, status),
          remember: () => decide(task.id, 'taken', repoId)
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
          <TriageRow
            key={task.id}
            task={task}
            repos={repos}
            suggested={suggestHqTriageProject(task, bindings)}
            busy={busyId === task.id}
            onOpen={() => setSelected(task)}
            onTake={(repoId) => void take(task, repoId)}
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
