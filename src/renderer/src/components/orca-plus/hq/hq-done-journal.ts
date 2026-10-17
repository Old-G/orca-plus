// Custom build (hq-done-journal): «Done for you» — what Orca+ did in the owner's name over the last
// week, newest first: requests turned into tasks or replies, and messages sent after his Approve.
import { HQ_DONE_WINDOW_MS, type HqSlackScoutDone } from '../../../../../shared/hq-slack-scout'
import type { HqDecision } from '../../../../../shared/hq-pulse-snapshot'
import type { OutgoingSentContext } from '../../../../../shared/outgoing-approval/outgoing-sent-context'

export type HqDoneWhat =
  | 'task-created'
  | 'task-taken'
  | 'replied'
  | 'skipped'
  | 'sent'
  | 'sent-edited'
  | 'not-sent'

export type HqDoneLink = { kind: 'task' | 'thread' | 'clickup'; url: string }

export type HqDoneEntry = {
  key: string
  at: number
  what: HqDoneWhat
  title: string
  detail: string | null
  links: HqDoneLink[]
  /** A skipped request that can still come back. */
  restoreId: string | null
  /** Custom build (hq-sent-history): an approval's destination, thread, project and chat. */
  sent?: OutgoingSentContext
  /** The whole message or command the approval let out. */
  message?: string
}

const SLACK_WHAT: Record<HqSlackScoutDone['decision'], HqDoneWhat> = {
  created: 'task-created',
  taken: 'task-taken',
  answered: 'replied',
  rejected: 'skipped'
}

const APPROVAL_WHAT = { approved: 'sent', edited: 'sent-edited', rejected: 'not-sent' } as const

// Why: the files are written by a model reading other people's text; only web links open.
function webUrl(url: string | undefined): string | null {
  return url && /^https:\/\/\S+$/.test(url) ? url : null
}

function fromRequest(done: HqSlackScoutDone): HqDoneEntry {
  const task = webUrl(done.taskUrl)
  const origin = webUrl(done.permalink)
  const links: HqDoneLink[] = []
  if (task) {
    links.push({ kind: 'task', url: task })
  }
  if (origin && origin !== task) {
    links.push({ kind: done.source === 'clickup' ? 'clickup' : 'thread', url: origin })
  }
  return {
    key: `request:${done.id}`,
    at: done.at,
    what: SLACK_WHAT[done.decision],
    title: done.title || done.id,
    detail: [done.author, done.source === 'clickup' ? 'ClickUp' : 'Slack']
      .filter(Boolean)
      .join(' · '),
    links,
    restoreId: done.decision === 'rejected' ? done.id : null
  }
}

function fromApproval(decision: HqDecision): HqDoneEntry | null {
  if (decision.kind !== 'approval' || !decision.outcome) {
    return null
  }
  const body = decision.body?.replace(/\s+/g, ' ').trim()
  return {
    key: `approval:${decision.id}`,
    at: decision.decidedAt,
    what: APPROVAL_WHAT[decision.outcome],
    title: decision.title,
    detail: body || null,
    links: [],
    restoreId: null,
    ...(decision.sent ? { sent: decision.sent } : {}),
    ...(decision.body ? { message: decision.body } : {})
  }
}

export function buildHqDoneJournal(
  requests: readonly HqSlackScoutDone[],
  decisions: readonly HqDecision[],
  now: number
): HqDoneEntry[] {
  return [
    ...requests.map(fromRequest),
    ...decisions.flatMap((decision) => fromApproval(decision) ?? [])
  ]
    .filter((entry) => entry.at > now - HQ_DONE_WINDOW_MS)
    .sort((a, b) => b.at - a.at)
}

/** Projects that sent something this week, for the journal's filter; most active first. */
export function hqDoneProjects(entries: readonly HqDoneEntry[]): string[] {
  const counts = new Map<string, number>()
  for (const entry of entries) {
    const project = entry.sent?.project
    if (project) {
      counts.set(project, (counts.get(project) ?? 0) + 1)
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([project]) => project)
}
