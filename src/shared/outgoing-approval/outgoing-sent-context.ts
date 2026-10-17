// Custom build (hq-sent-history): what an approved (or rejected) outgoing call was, kept with its
// decision — where it went, which thread it answered, and which project and chat sent it — so the
// history can say more than «Slack · send message».
import type { PulseDraft } from '../pulse-types'
import { readInputString } from './outgoing-action'
import { lastPathSegment, type OutgoingApprovalContext } from './outgoing-approval-bell'
import { outgoingRef } from './outgoing-footer'

export type OutgoingSentContext = {
  service: string | null
  operation: string | null
  /** `#channel`, `DM with Name`; null when it could not be named. */
  targetName: string | null
  /** The raw channel, user, task or host the call named. */
  targetId: string | null
  threadTs: string | null
  /** Who said what the call answered, in a thread. */
  replyingTo: string | null
  chatName: string | null
  agentSessionId: string | null
  worktreeId: string | null
  /** Folder of the workspace the call ran in. */
  project: string | null
  /** A decision from before this was kept: the approval card's first line, as the owner saw it. */
  head: string | null
  /** Custom build (outgoing-footer): the ClickUp task it was about. */
  taskId: string | null
  taskUrl: string | null
  taskName: string | null
  /** The short code its footer carries; the history finds the message by it. */
  ref: string | null
  /** The footer line it was sent with; null when sent without one. */
  footer: string | null
}

export type OutgoingSentExtras = {
  worktreeId?: string | null
  head?: string | null
  footer?: string | null
}

export function outgoingSentContext(
  draft: PulseDraft,
  named: OutgoingApprovalContext = {},
  extras: OutgoingSentExtras = {}
): OutgoingSentContext {
  const call = draft.call
  return {
    service: call?.service || null,
    operation: call?.operation || null,
    targetName: named.targetName ?? null,
    targetId: draft.target,
    threadTs: readInputString(call?.toolInput, 'thread_ts') || null,
    replyingTo: named.replyingTo ?? null,
    chatName: named.chatName ?? null,
    agentSessionId: call?.agentSessionId ?? null,
    worktreeId: extras.worktreeId ?? null,
    project: lastPathSegment(call?.cwd),
    head: extras.head ?? null,
    taskId: named.task?.id ?? null,
    taskUrl: named.task?.url ?? null,
    taskName: named.task?.name ?? null,
    ref: outgoingRef(draft.id),
    footer: extras.footer ?? null
  }
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null
}

/** Null for anything that is not a stored context; unknown fields read as missing. */
export function parseOutgoingSentContext(json: string | null): OutgoingSentContext | null {
  if (!json) {
    return null
  }
  let value: unknown
  try {
    value = JSON.parse(json)
  } catch {
    return null
  }
  return readOutgoingSentContext(value)
}

export function readOutgoingSentContext(value: unknown): OutgoingSentContext | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  const field = (key: string): string | null => text(Reflect.get(value, key))
  return {
    service: field('service'),
    operation: field('operation'),
    targetName: field('targetName'),
    targetId: field('targetId'),
    threadTs: field('threadTs'),
    replyingTo: field('replyingTo'),
    chatName: field('chatName'),
    agentSessionId: field('agentSessionId'),
    worktreeId: field('worktreeId'),
    project: field('project'),
    head: field('head'),
    taskId: field('taskId'),
    taskUrl: field('taskUrl'),
    taskName: field('taskName'),
    ref: field('ref'),
    footer: field('footer')
  }
}
