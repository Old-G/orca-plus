// Custom build (hq-triage): what «Take» does for one task — Claude in a fresh worktree of one project, or a
// coordinator in the HQ workspace for several — shared by the button and (hq-night-shift) the night run.
import { toast } from 'sonner'
import type { ClickUpTaskSummary } from '../../../../../shared/clickup-types'
import type { HqAutonomyLevel } from '../../../../../shared/hq-autonomy'
import type { Repo } from '../../../../../shared/repo-types'
import type { TaskSourceContext } from '../../../../../shared/task-source-context'
import { HQ_TAKE_EFFORT, withHqTakeEffort } from '../../../../../shared/hq-triage'
import { translate } from '@/i18n/i18n'
import {
  clickUpGetTask,
  clickUpListStatuses,
  clickUpUpdateTaskStatus
} from '@/runtime/runtime-clickup-client'
import { useAppStore } from '@/store'
import { agentPaneKeys, findHqWorktreeId, launchHqCommand } from './hq-today-actions'
import { patchHqTriageDecision, rememberHqTake, type HqTakenSession } from './hq-triage-decisions'
import {
  buildHqCoordinatorWorkItem,
  buildHqTriageWorkItem,
  takeHqTriageTask,
  type HqTriageTakeResult
} from './hq-triage-take'
import { launchHqTakeInRepo } from './hq-take-launch'

/** Custom build (hq-night-shift): nobody is awake to answer, so the agent stays inside the worktree. */
export const HQ_NIGHT_SHIFT_NOTE = [
  'Ночная смена: Глеб спит и ответить не может.',
  'Делай только в worktree — ничего не пушь, не открывай MR, никому не пиши, прод не трогай, даже если уровень проекта выше.',
  'Неясное — не спрашивай, а выбери разумный вариант и запиши вопрос в отчёт; утром Глеб посмотрит в «Ready for you».'
].join('\n')

const NIGHT_LEVEL_CAP: HqAutonomyLevel = 1

export type HqTakeContext = {
  sourceContext: TaskSourceContext | null
  /** Git projects to pick from. */
  repos: readonly Repo[]
  levelOf: (repoId: string) => HqAutonomyLevel
  /** The new-workspace dialog when a direct launch cannot start; absent at night. */
  openComposer?: (task: ClickUpTaskSummary, repoId: string) => void
  night?: boolean
}

export function reportHqTake(result: HqTriageTakeResult, task: ClickUpTaskSummary): void {
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

export async function runHqTake(
  task: ClickUpTaskSummary,
  repoIds: readonly string[],
  ctx: HqTakeContext
): Promise<HqTriageTakeResult> {
  const chosen = repoIds.flatMap((id) => ctx.repos.filter((repo) => repo.id === id))
  const [main] = chosen
  if (!main) {
    return { launched: false }
  }
  const levelOf = (repoId: string): HqAutonomyLevel => {
    const level = ctx.levelOf(repoId)
    return ctx.night && level > NIGHT_LEVEL_CAP ? NIGHT_LEVEL_CAP : level
  }
  const extra = ctx.night ? HQ_NIGHT_SHIFT_NOTE : undefined
  const sessionOptions = withHqTakeEffort(useAppStore.getState().settings?.nativeChatSessionOptions)
  const coordinate = chosen.length > 1
  const { sourceContext } = ctx
  let session: HqTakenSession | null = null
  return takeHqTriageTask(
    task,
    (full) =>
      coordinate
        ? buildHqCoordinatorWorkItem(
            task,
            full,
            {
              projects: chosen.map((repo) => ({
                name: repo.displayName,
                path: repo.path,
                level: levelOf(repo.id)
              })),
              model: sessionOptions.claude?.model ?? 'opus',
              effort: HQ_TAKE_EFFORT
            },
            extra
          )
        : buildHqTriageWorkItem(
            task,
            full,
            { name: main.displayName, level: levelOf(main.id) },
            extra
          ),
    {
      getTask: (taskId) => clickUpGetTask(sourceContext, taskId),
      launch: async (item) => {
        if (!coordinate) {
          const launched = await launchHqTakeInRepo({
            item,
            repoId: main.id,
            sessionOptions,
            openModalFallback: () => ctx.openComposer?.(task, main.id)
          })
          session = launched.session
          return launched.launched
        }
        const state = useAppStore.getState()
        const hqWorktreeId = findHqWorktreeId(
          state.settings?.hqPath,
          state.repos,
          state.worktreesByRepo
        )
        const before = hqWorktreeId ? agentPaneKeys(hqWorktreeId) : new Set<string>()
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
        } else if (hqWorktreeId) {
          session = { worktreeId: hqWorktreeId, before, coordinator: true }
        }
        return launched.ok
      },
      listStatuses: (listId) => clickUpListStatuses(sourceContext, listId),
      setStatus: (taskId, status) => clickUpUpdateTaskStatus(sourceContext, taskId, status),
      remember: async () => {
        await rememberHqTake(task.id, main.id, session)
        if (ctx.night) {
          await patchHqTriageDecision(task.id, { night: true })
        }
      }
    }
  )
}
