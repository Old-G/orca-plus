// Custom build (hq-triage): HQ «New tasks» — the owner's fresh ClickUp tasks, each with a suggested
// project; nothing starts until the owner takes one.
import type { ClickUpStatus, ClickUpTaskSummary } from './clickup-types'
import type { HqAutonomyLevel } from './hq-autonomy'
import type { HqProjectClickUpLists } from './hq-project-clickup'

export type HqTriageDecision = {
  decision: 'taken' | 'hidden'
  at: number
  /** The project a taken task went to. */
  repoId?: string
}

/** By ClickUp task id. */
export type HqTriageDecisions = Record<string, HqTriageDecision>

/**
 * Tasks still in their list's first status that the owner has neither taken nor hidden. A task already
 * moved along (in process, review…) is being worked on and needs no triage.
 */
export function pendingHqTriageTasks(
  tasks: readonly ClickUpTaskSummary[],
  decisions: HqTriageDecisions,
  snoozed: ReadonlySet<string>
): ClickUpTaskSummary[] {
  return tasks.filter(
    (task) => task.status.type === 'open' && !decisions[task.id] && !snoozed.has(task.id)
  )
}

/** The project whose HQ card is bound to the task's ClickUp list. */
export function suggestHqTriageProject(
  task: Pick<ClickUpTaskSummary, 'listId'>,
  bindings: HqProjectClickUpLists | undefined
): string | null {
  if (!task.listId) {
    return null
  }
  const match = Object.entries(bindings ?? {}).find(([, binding]) => binding.listId === task.listId)
  return match ? match[0] : null
}

/** The list's «in process» status; LH spells it with a Cyrillic «с», so both spellings match. */
export function findInProcessStatus(statuses: readonly ClickUpStatus[]): ClickUpStatus | null {
  return (
    statuses.find((status) =>
      /^in[\s_-]*pro[cс]ess$/.test(status.name.trim().toLowerCase().replace(/\s+/g, ' '))
    ) ?? null
  )
}

const LEVEL_SCOPE: Record<HqAutonomyLevel, string> = {
  0: 'Уровень автономии проекта 0: ничего не меняй в коде. Разберись в задаче и проекте и напиши план в файл PLAN.md в этом worktree — что и где поменять, вопросы к автору задачи. Остановись и покажи план.',
  1: 'Уровень автономии проекта 1: сделай задачу в этом worktree — код, тесты, локальные коммиты. Наружу ничего не отправляй: без push, PR, сообщений и записей в ClickUp.',
  2: 'Уровень автономии проекта 2: сделай задачу в этом worktree, затем запушь ветку и открой PR/MR. Не мержь.',
  3: 'Уровень автономии проекта 3: сделай задачу, открой PR/MR и смержи его, когда проверки зелёные.'
}

/**
 * The first message of the agent a taken task starts. The title stays out: anyone in the workspace
 * writes it, so it travels only inside the untrusted task block that follows.
 */
export function hqTriagePrompt(args: {
  identifier: string
  url: string
  projectName: string
  level: HqAutonomyLevel
}): string {
  return [
    `Возьми в работу задачу ClickUp ${args.identifier} (${args.url}) в проекте ${args.projectName}.`,
    'Начни с того, что прочитай задачу целиком и вики проекта, и коротко напиши план.',
    LEVEL_SCOPE[args.level],
    'Прод (деплой, живые данные, прод-флоу n8n) — только после явного «да» владельца, при любом уровне.'
  ].join('\n')
}
