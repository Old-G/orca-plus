// Custom build (outgoing-footer): where a held message finds its ClickUp task — the chat's earlier
// messages, and ClickUp itself for the task's link and name.
import type { OutgoingTaskRef } from '../../../shared/outgoing-approval/outgoing-footer'
import { getClickUpTask } from '../../clickup/clickup-tasks'
import type { PulseDb } from '../pulse/pulse-db'

const RECENT_DECISIONS = 200
const known = new Map<string, OutgoingTaskRef>()

/** The task of this chat's newest approval that had one. */
export function lastChatTask(db: PulseDb, agentSessionId: string): OutgoingTaskRef | null {
  for (const decision of db.listDecisions({ kind: 'approval', limit: RECENT_DECISIONS })) {
    const sent = decision.sentContext
    if (sent?.agentSessionId === agentSessionId && sent.taskId) {
      return { id: sent.taskId, url: sent.taskUrl, name: sent.taskName }
    }
  }
  return null
}

/** Null when ClickUp is not connected or has no such task; found tasks are remembered. */
export async function clickUpTaskRef(id: string): Promise<OutgoingTaskRef | null> {
  const cached = known.get(id)
  if (cached) {
    return cached
  }
  const task = await getClickUpTask(id)
  if (!task) {
    return null
  }
  const ref = { id: task.identifier, url: task.url, name: task.title }
  known.set(id, ref)
  return ref
}
