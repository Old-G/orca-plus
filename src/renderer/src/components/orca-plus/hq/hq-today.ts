// Custom build (hq): what the HQ «Today» tab puts first — agents waiting on the user or finished
// unread, waitings by urgency, and the user's ClickUp tasks due today or overdue.
import type { ClickUpTaskSummary } from '../../../../../shared/clickup-types'
import type { DashboardCard } from '../../../../../shared/dashboard-snapshot'
import { translate } from '@/i18n/i18n'
import type { HqWaiting } from './hq-pulse-snapshot'

const DAY_MS = 86_400_000

export type HqTodayAgents = {
  /** Blocked on or waiting for the user, longest waiting first. */
  needYou: DashboardCard[]
  /** Finished and not looked at yet, newest first. */
  finished: DashboardCard[]
  working: number
}

export function buildHqTodayAgents(cards: readonly DashboardCard[]): HqTodayAgents {
  return {
    needYou: cards
      .filter((card) => card.bucket === 'attention')
      .sort((a, b) => a.stateChangedAt - b.stateChangedAt),
    finished: cards
      .filter((card) => card.bucket === 'done' && card.unseen)
      .sort((a, b) => (b.finishedAt ?? 0) - (a.finishedAt ?? 0)),
    working: cards.filter((card) => card.bucket === 'working').length
  }
}

function startOfDay(now: number): number {
  const date = new Date(now)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

/** Overdue first (most overdue on top), then due soonest, then the oldest without a date. */
export function sortHqTodayWaitings(waitings: readonly HqWaiting[]): HqWaiting[] {
  return [...waitings].sort((a, b) => {
    if (a.dueAt !== null && b.dueAt !== null) {
      return a.dueAt - b.dueAt
    }
    if (a.dueAt !== null || b.dueAt !== null) {
      return a.dueAt !== null ? -1 : 1
    }
    return a.createdAt - b.createdAt
  })
}

export type HqTodayTasks = {
  /** Due before today began, most overdue first. */
  overdue: ClickUpTaskSummary[]
  /** Due within today, earliest first. */
  today: ClickUpTaskSummary[]
}

/** Local days; a task without a due date is not today's business. */
export function buildHqTodayTasks(tasks: readonly ClickUpTaskSummary[], now: number): HqTodayTasks {
  const dayStart = startOfDay(now)
  const dayEnd = dayStart + DAY_MS
  const dated = tasks
    .filter((task): task is ClickUpTaskSummary & { dueDate: number } => task.dueDate !== null)
    .sort((a, b) => a.dueDate - b.dueDate)
  return {
    overdue: dated.filter((task) => task.dueDate < dayStart),
    today: dated.filter((task) => task.dueDate >= dayStart && task.dueDate < dayEnd)
  }
}

/** Whole days a due date lies before today; 0 for today or later. */
export function hqDaysOverdue(dueAt: number, now: number): number {
  return Math.max(0, Math.round((startOfDay(now) - startOfDay(dueAt)) / DAY_MS))
}

/** What a Remind run is told; sending stays behind the outgoing-approval gate. */
export function hqReminderPrompt(person: string | null, title: string): string {
  return person
    ? translate(
        'auto.hq.today.remindPrompt',
        'Remind {{value0}} about: “{{value1}}”. Find where we talk with them (Slack first), write a short polite reminder and send it. Sending waits for my approval.',
        { value0: person, value1: title }
      )
    : translate(
        'auto.hq.today.remindPromptNoPerson',
        'Remind the person I am waiting on about: “{{value0}}”. Work out who it is from HQ, write a short polite reminder where we talk (Slack first) and send it. Sending waits for my approval.',
        { value0: title }
      )
}
