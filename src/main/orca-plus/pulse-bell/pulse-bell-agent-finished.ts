// Custom build (pulse-bell): an agent that finished a turn gets an Inbox item naming which agent it was,
// with Open to jump there. Fed by the same completion notifications as the desktop banner.
import { formatAgentTypeLabel } from '../../../shared/agent-type-label'
import type { NotificationDispatchRequest } from '../../../shared/notification-settings-types'
import {
  agentFinishedBellItem,
  PULSE_BELL_KIND,
  type FinishedAgent
} from '../../../shared/pulse-bell'
import type { PulseInboxInput, PulseInboxItem } from '../../../shared/pulse-types'

export type AgentFinishedInbox = {
  list: () => PulseInboxItem[]
  add: (input: PulseInboxInput) => void
  markDone: (id: string, action: string) => void
}

let inbox: AgentFinishedInbox | null = null

export function bindAgentFinishedInbox(target: AgentFinishedInbox | null): void {
  inbox = target
}

/** Null for anything but a finished turn — a waiting or blocked agent is the agent-waiting item's job. */
export function finishedAgentFromNotification(
  request: NotificationDispatchRequest
): FinishedAgent | null {
  if (request.source !== 'agent-task-complete' || !request.paneKey) {
    return null
  }
  if (request.agentState && request.agentState !== 'done') {
    return null
  }
  const repo = request.repoLabel?.trim() || null
  const worktree = request.worktreeLabel?.trim() || null
  return {
    paneKey: request.paneKey,
    worktreeId: request.worktreeId ?? null,
    agentLabel: formatAgentTypeLabel(request.agentType),
    place: repo && worktree && repo !== worktree ? `${repo} / ${worktree}` : (worktree ?? repo),
    sessionTitle: request.terminalTitle?.trim() || null,
    lastMessage: request.agentLastAssistantMessage ?? null
  }
}

function openItemsFor(paneKeys: ReadonlySet<string>): PulseInboxItem[] {
  return (inbox?.list() ?? []).filter(
    (item) =>
      item.kind === PULSE_BELL_KIND.agentFinished &&
      item.dedupeKey !== null &&
      paneKeys.has(item.dedupeKey.slice(`${PULSE_BELL_KIND.agentFinished}:`.length))
  )
}

export function recordAgentFinished(request: NotificationDispatchRequest): void {
  const agent = inbox ? finishedAgentFromNotification(request) : null
  if (!inbox || !agent) {
    return
  }
  try {
    // Why: the open item dedupes by pane, so the older finish must close for the newer text to show.
    for (const item of openItemsFor(new Set([agent.paneKey]))) {
      inbox.markDone(item.id, 'replaced')
    }
    inbox.add(agentFinishedBellItem(agent))
  } catch (error) {
    console.warn('[pulse-bell] agent-finished item failed:', error)
  }
}

/**
 * The agent works again, or the user has looked at the pane: its finished item no longer needs them.
 * `workingSince` is when that work began; work that began before the finish is the finished turn
 * itself, re-published after its completion, and leaves the item open.
 */
export function clearAgentFinished(
  paneKeys: readonly string[],
  action: 'gone' | 'seen',
  workingSince?: number
): void {
  if (!inbox || paneKeys.length === 0) {
    return
  }
  try {
    for (const item of openItemsFor(new Set(paneKeys))) {
      if (workingSince !== undefined && workingSince < item.createdAt) {
        continue
      }
      inbox.markDone(item.id, action)
    }
  } catch (error) {
    console.warn('[pulse-bell] clearing agent-finished items failed:', error)
  }
}
