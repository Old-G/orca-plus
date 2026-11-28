// Custom build (outgoing-approval-target): names what a held call's card shows — the Slack channel or
// person it reaches, the thread message it answers, the agent chat that sends it. Each part is best
// effort: whatever cannot be named keeps the raw id the card showed before.
import type { HqSlackScoutIndex } from '../../hq-today/hq-slack-scout-index'
import type {
  OutgoingApprovalContext,
  OutgoingSourceMessage
} from '../../../shared/outgoing-approval/outgoing-approval-bell'
import { readInputString } from '../../../shared/outgoing-approval/outgoing-action'
import {
  findOutgoingTask,
  type OutgoingTaskRef
} from '../../../shared/outgoing-approval/outgoing-footer'
import type { PulseDraft } from '../../../shared/pulse-types'

export type OutgoingContextSources = {
  slackName: (id: string) => Promise<string | null>
  scout: () => Promise<HqSlackScoutIndex | null>
  chatName: (agentSessionId: string) => string | null
  /** Custom build (hq-router crumbs): the name of the sending chat's Lead, for the footer. */
  leadName?: (agentSessionId: string) => string | null
  /** Custom build (hq-router graph): the task the chat writes for (a one-off chat: its parent's). */
  taskId?: (agentSessionId: string) => string | null
  /** Custom build (outgoing-footer): the task this chat's last message was about. */
  lastTask: (agentSessionId: string) => OutgoingTaskRef | null
  /** Custom build (hq-approve-source): the ledger's whole line a Slack reply answers; null when it has none. */
  slackSource?: (
    channel: string,
    threadTs: string | null
  ) => Omit<OutgoingSourceMessage, 'where'> | null
  /** The task's link and name from ClickUp; null when ClickUp cannot say. */
  clickUpTask: (id: string) => Promise<OutgoingTaskRef | null>
}

const QUOTE_MAX = 80

function quoted(said: string): string {
  const line = said.replace(/\s+/g, ' ').trim()
  return `«${line.length > QUOTE_MAX ? `${line.slice(0, QUOTE_MAX - 1)}…` : line}»`
}

async function slackTargetName(
  target: string,
  sources: OutgoingContextSources,
  scout: HqSlackScoutIndex | null
): Promise<string | null> {
  const ids = target.split(',').map((id) => id.trim())
  const names = await Promise.all(
    ids.map(async (id) => (await sources.slackName(id)) ?? scout?.channelNames.get(id) ?? null)
  )
  return names.every((name) => name === null)
    ? null
    : names.map((name, index) => name ?? ids[index]).join(', ')
}

/** Custom build (outgoing-footer): a comment's own task, else one the text names, else the chat's. */
async function outgoingTask(
  draft: PulseDraft,
  chatName: string | null,
  sources: OutgoingContextSources
): Promise<OutgoingTaskRef | null> {
  const call = draft.call
  const commentTask =
    call && /clickup/i.test(call.service) && /\bcomment\b/.test(call.operation) && draft.target
      ? { id: draft.target, url: null, name: null }
      : null
  const found =
    commentTask ??
    findOutgoingTask(draft.body) ??
    (call?.agentSessionId ? sources.lastTask(call.agentSessionId) : null) ??
    findOutgoingTask(chatName)
  if (!found || (found.url && found.name)) {
    return found
  }
  return (await sources.clickUpTask(found.id).catch(() => null)) ?? found
}

export async function describeOutgoingDraft(
  draft: PulseDraft,
  sources: OutgoingContextSources
): Promise<OutgoingApprovalContext> {
  const call = draft.call
  const chatName = call?.agentSessionId ? sources.chatName(call.agentSessionId) : null
  const task = await outgoingTask(draft, chatName, sources)
  const leadName = call?.agentSessionId ? (sources.leadName?.(call.agentSessionId) ?? null) : null
  const taskId = call?.agentSessionId ? (sources.taskId?.(call.agentSessionId) ?? null) : null
  const crumb = { ...(leadName ? { leadName } : {}), ...(taskId ? { taskId } : {}) }
  if (!call || !/slack/i.test(call.service) || !draft.target) {
    return { chatName, task, ...crumb }
  }
  const scout = await sources.scout().catch(() => null)
  const threadTs = readInputString(call.toolInput, 'thread_ts')
  const channelId = draft.target.split(',')[0]?.trim()
  const thread = threadTs && channelId ? scout?.threads.get(`${channelId}:${threadTs}`) : undefined
  const replyingTo = thread
    ? [thread.author, thread.said ? quoted(thread.said) : null].filter(Boolean).join(': ') || null
    : null
  const targetName = await slackTargetName(draft.target, sources, scout)
  const ledgerLine = channelId ? (sources.slackSource?.(channelId, threadTs ?? null) ?? null) : null
  // Why where is filled here: the ledger names no places, the card already knows this one.
  const source = ledgerLine ? { ...ledgerLine, where: targetName } : null
  return { chatName, task, ...crumb, targetName, replyingTo, ...(source ? { source } : {}) }
}
