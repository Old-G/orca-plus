// Custom build (hq-closing): taking a task whose agent finished the rest of the way — what each
// «Ready for you» button tells the agent, which taken tasks are ready, and the ClickUp «check» status.
import type { ClickUpStatus, ClickUpTaskSummary } from './clickup-types'
import type { HqTriageDecision, HqTriageDecisions } from './hq-triage'

/** What the owner's buttons tell the task's agent; the owner's click is the permission they carry. */
export const HQ_CLOSING_MESSAGES = {
  accept:
    'Владелец принял работу по задаче. Запушь ветку и открой MR в GitLab (PR, если репозиторий на GitHub; если задача шла через исполнителей — в каждом репозитории): заголовок и описание по сделанному, со ссылкой на задачу ClickUp. MR уже открыт — обнови его. Не мержь. Ответь ссылками на MR.',
  merge:
    'Владелец разрешил merge. Смержи MR/PR этой задачи (у исполнителей — каждый), когда проверки зелёные: пайплайн ещё идёт — дождись или включи auto-merge; конфликт или красные проверки — не мержь, опиши, что мешает. Если после merge запускается деплой на прод — скажи об этом в ответе. Ответь, что и куда смержено.',
  comment:
    'Подготовь комментарий к задаче ClickUp по канону скилла lh-task-writeup — только текст. В ClickUp сам ничего не отправляй и статус не меняй: владелец отправит комментарий из HQ. Ответь одним сообщением — только текст комментария, без вступления и пояснений.',
  checkSpec:
    'Проверь сделанное по скиллу lh-check-spec: вторая модель сверяет изменения с критериями приёмки задачи. Ничего наружу не отправляй. Ответь таблицей «критерий — выполнен / нет / не проверить» и что осталось сделать.'
} as const

export type HqClosingMessage = keyof typeof HQ_CLOSING_MESSAGES

/** The closing steps that keep a task on «Ready for you» even while its agent works on them. */
function closingStarted(decision: HqTriageDecision): boolean {
  return Boolean(
    decision.acceptedAt ?? decision.mergeAskedAt ?? decision.commentAskedAt ?? decision.commentedAt
  )
}

export type HqAgentCardLike = {
  paneKey: string
  worktreeId: string
  bucket: 'attention' | 'working' | 'done' | 'idle'
  finishedAt: number | null
  lastAgentMessage?: string
}

/** The task's agent: the pane recorded at Take, else (pane not caught) the worktree's only agent. */
export function findHqTaskAgent<C extends HqAgentCardLike>(
  decision: HqTriageDecision,
  cards: readonly C[]
): C | null {
  if (decision.paneKey) {
    return cards.find((card) => card.paneKey === decision.paneKey) ?? null
  }
  const own = cards.filter((card) => card.worktreeId === decision.worktreeId)
  // Why: the HQ workspace runs many chats; without the pane, a coordinator's card is unknowable.
  return !decision.coordinator && own.length === 1 ? (own[0] ?? null) : null
}

export function isHqAgentBusy(card: HqAgentCardLike | null): boolean {
  return card?.bucket === 'working' || card?.bucket === 'attention'
}

/** The «check» status of the task's list (LH: «сделано, проверяйте»). */
export function findCheckStatus(statuses: readonly ClickUpStatus[]): ClickUpStatus | null {
  return statuses.find((status) => status.name.trim().toLowerCase() === 'check') ?? null
}

export type HqReadyTask<C> = {
  task: ClickUpTaskSummary
  decision: HqTriageDecision
  agent: C | null
}

/**
 * Taken tasks whose agent is done, or whose closing the owner already started. Tasks taken before
 * HQ remembered the worktree, and tasks already in «check», stay out.
 */
export function readyHqTasks<C extends HqAgentCardLike>(
  tasks: readonly ClickUpTaskSummary[],
  decisions: HqTriageDecisions,
  cards: readonly C[]
): HqReadyTask<C>[] {
  return tasks.flatMap((task) => {
    const decision = decisions[task.id]
    if (decision?.decision !== 'taken' || !decision.worktreeId || findCheckStatus([task.status])) {
      return []
    }
    const agent = findHqTaskAgent(decision, cards)
    // Why: no card yet means the agent has not started (or its pane was never caught), not «done».
    const finished = agent !== null && !isHqAgentBusy(agent)
    return finished || closingStarted(decision) ? [{ task, decision, agent }] : []
  })
}

/** The agent's answer to «draft the comment», once it finished after being asked. */
export function hqCommentDraft(
  decision: HqTriageDecision,
  agent: HqAgentCardLike | null
): string | null {
  // Why: a later message (accept, rework…) makes the agent's last answer about something else.
  if (
    !decision.commentAskedAt ||
    (decision.lastToldAt ?? 0) > decision.commentAskedAt ||
    !agent ||
    isHqAgentBusy(agent)
  ) {
    return null
  }
  const text = agent.lastAgentMessage?.trim()
  return text && (agent.finishedAt ?? 0) >= decision.commentAskedAt ? text : null
}

/** Hours the owner may type: positive, at most 1000; a comma works as the decimal mark. */
export function parseHqHours(text: string): number | null {
  const hours = Number(text.trim().replace(',', '.'))
  return Number.isFinite(hours) && hours > 0 && hours <= 1_000 ? hours : null
}
