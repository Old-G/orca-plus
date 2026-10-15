// Custom build (hq-today-inbox): Today as a messenger («New view») — every item that needs the owner,
// grouped by urgency for the list on the left; the right pane opens one of them.
import type { ClickUpTaskSummary } from '../../../../../shared/clickup-types'
import type { DashboardCard } from '../../../../../shared/dashboard-snapshot'
import type { HqReview } from '../../../../../shared/hq-project-pages'
import { hqSlackRequestKind, type HqSlackScoutDraft } from '../../../../../shared/hq-slack-scout'

export const HQ_INBOX_SECTIONS = ['needs', 'ready', 'tasks', 'reviews'] as const
export type HqInboxSection = (typeof HQ_INBOX_SECTIONS)[number]

export type HqInboxItem =
  | { key: string; section: 'needs'; kind: 'slack'; draft: HqSlackScoutDraft; at: number | null }
  | { key: string; section: 'needs'; kind: 'agent'; card: DashboardCard; at: number | null }
  | { key: string; section: 'ready'; kind: 'ready'; task: ClickUpTaskSummary; at: number | null }
  | { key: string; section: 'tasks'; kind: 'new-task'; task: ClickUpTaskSummary; at: number | null }
  | {
      key: string
      section: 'tasks'
      kind: 'due'
      task: ClickUpTaskSummary
      overdue: boolean
      at: number | null
    }
  | { key: string; section: 'reviews'; kind: 'review'; review: HqReview; at: number | null }

export type HqInboxSources = {
  slack: readonly HqSlackScoutDraft[]
  waitingAgents: readonly DashboardCard[]
  ready: readonly ClickUpTaskSummary[]
  newTasks: readonly ClickUpTaskSummary[]
  due: { overdue: readonly ClickUpTaskSummary[]; today: readonly ClickUpTaskSummary[] }
  reviews: readonly HqReview[]
}

function foundAt(draft: HqSlackScoutDraft): number | null {
  const at = Date.parse(draft.foundAt)
  return Number.isNaN(at) ? null : at
}

/** FYIs last: they only inform. */
function slackRank(draft: HqSlackScoutDraft): number {
  return hqSlackRequestKind(draft) === 'fyi' ? 1 : 0
}

export function buildHqInboxItems(sources: HqInboxSources): HqInboxItem[] {
  const slack = [...sources.slack].sort((a, b) => slackRank(a) - slackRank(b))
  // Why: a task a Slack request already turned into stays one item, not two.
  const seen = new Set<string>()
  const once = (task: ClickUpTaskSummary): boolean => {
    if (seen.has(task.id)) {
      return false
    }
    seen.add(task.id)
    return true
  }
  return [
    ...slack.map((draft): HqInboxItem => ({
      key: `slack:${draft.id}`,
      section: 'needs',
      kind: 'slack',
      draft,
      at: foundAt(draft)
    })),
    ...sources.waitingAgents.map((card): HqInboxItem => ({
      key: `agent:${card.paneKey}`,
      section: 'needs',
      kind: 'agent',
      card,
      at: card.stateChangedAt || null
    })),
    ...sources.ready.filter(once).map((task): HqInboxItem => ({
      key: `ready:${task.id}`,
      section: 'ready',
      kind: 'ready',
      task,
      at: task.updatedAt
    })),
    ...sources.newTasks.filter(once).map((task): HqInboxItem => ({
      key: `new:${task.id}`,
      section: 'tasks',
      kind: 'new-task',
      task,
      at: task.updatedAt
    })),
    ...[
      ...sources.due.overdue.map((task) => ({ task, overdue: true })),
      ...sources.due.today.map((task) => ({ task, overdue: false }))
    ]
      .filter(({ task }) => once(task))
      .map(({ task, overdue }): HqInboxItem => ({
        key: `due:${task.id}`,
        section: 'tasks',
        kind: 'due',
        task,
        overdue,
        at: task.dueDate
      })),
    ...sources.reviews.map((review): HqInboxItem => ({
      key: `review:${review.url}`,
      section: 'reviews',
      kind: 'review',
      review,
      at: review.updatedAt
    }))
  ]
}

/** Two letters for the row's badge: the asker, the agent's project or the source. */
export function hqInboxBadge(item: HqInboxItem): string {
  const from = (text: string): string =>
    text
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim()
      .slice(0, 2)
      .toUpperCase() || '··'
  switch (item.kind) {
    case 'slack':
      return from(item.draft.author || item.draft.channelName)
    case 'agent':
      return from(item.card.repoName)
    case 'review':
      return item.review.provider === 'github' ? 'GH' : 'GL'
    case 'ready':
    case 'new-task':
    case 'due':
      return 'CU'
  }
}

/** The key to open first: the most urgent item, or the one still open if it is still there. */
export function pickHqInboxKey(
  items: readonly HqInboxItem[],
  current: string | null
): string | null {
  return items.some((item) => item.key === current) ? current : (items[0]?.key ?? null)
}
