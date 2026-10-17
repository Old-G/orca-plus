// Custom build (outgoing-footer): the line an approved message to a person ends with — the task it is
// about, the project and chat that sent it, and a ref the history finds it by — so neither the reader
// nor the owner loses where it came from.
import { parseClickUpTaskReference } from '../clickup-task-reference'
import type { PulseDraft } from '../pulse-types'
import type { OutgoingDraftCall } from './outgoing-action'

export type OutgoingTaskRef = {
  /** `DEV-123`, or the task id when the workspace has no custom ids. */
  id: string
  url: string | null
  name: string | null
}

export type OutgoingFooterParts = {
  task: OutgoingTaskRef | null
  project: string | null
  chatName: string | null
  ref: string
}

const FOOTER_MARK = '↳ '
const CHAT_MAX = 60
const TASK_URL = /https?:\/\/app\.clickup\.com\/t\/[\w/-]+/i
// Why: only DEV- is the team's task prefix; ISO-8601, UTF-8 and the like are not tasks.
const TASK_CUSTOM_ID = /\b(DEV-\d{2,7})\b/

/** Six characters of the held call's id: short enough to type, unique enough within a week. */
export function outgoingRef(draftId: string): string {
  return draftId
    .replace(/[^0-9a-z]/gi, '')
    .slice(0, 6)
    .toLowerCase()
}

/** Slack messages and ClickUp comments reach a person to read; nothing else gets a footer. */
export function takesOutgoingFooter(call: OutgoingDraftCall | null | undefined): boolean {
  if (!call?.editField) {
    return false
  }
  if (/slack/i.test(call.service)) {
    return /\b(send|reply|schedule)\b/.test(call.operation) && !/\bdraft\b/.test(call.operation)
  }
  return /clickup/i.test(call.service) && /\bcomment\b/.test(call.operation)
}

/** The first ClickUp task a text links or names, in the order given. */
export function findOutgoingTask(
  ...texts: readonly (string | null | undefined)[]
): OutgoingTaskRef | null {
  for (const text of texts) {
    if (!text) {
      continue
    }
    const url = TASK_URL.exec(text)?.[0] ?? null
    const linked = url ? parseClickUpTaskReference(url) : null
    if (url && linked) {
      return { id: linked.id, url, name: null }
    }
    const custom = TASK_CUSTOM_ID.exec(text)?.[1]
    if (custom) {
      return { id: custom, url: null, name: null }
    }
  }
  return null
}

function plain(text: string, max: number): string {
  const line = text.replace(/[\s*`[\]]+/g, ' ').trim()
  return line.length > max ? `${line.slice(0, max - 1)}…` : line
}

/** `↳ [DEV-1](url) · project · «chat» · ref abc123`; a ClickUp comment skips its own task. */
export function outgoingFooter(
  parts: OutgoingFooterParts,
  commentTaskId: string | null = null
): string {
  const task =
    parts.task && parts.task.id !== commentTaskId
      ? parts.task.url
        ? `[${parts.task.id}](${parts.task.url})`
        : parts.task.id
      : null
  const items = [
    task,
    parts.project ? plain(parts.project, CHAT_MAX) : null,
    parts.chatName ? `«${plain(parts.chatName, CHAT_MAX)}»` : null,
    `ref ${parts.ref}`
  ].filter(Boolean)
  return `${FOOTER_MARK}${items.join(' · ')}`
}

/** The text as sent: the footer goes on its own line in italics, once. */
export function withOutgoingFooter(text: string, footer: string | null): string {
  if (!footer) {
    return text
  }
  const ref = /ref [0-9a-z]{6}$/.exec(footer)?.[0]
  if (ref && text.includes(ref)) {
    return text
  }
  return `${text.trimEnd()}\n\n_${footer}_`
}

/** The footer a held call would be sent with; null for a call that takes none. */
export function outgoingFooterFor(
  draft: PulseDraft,
  context: { task?: OutgoingTaskRef | null; chatName?: string | null } = {}
): string | null {
  const call = draft.call
  if (!takesOutgoingFooter(call)) {
    return null
  }
  const project = call?.cwd?.split(/[\\/]/).findLast(Boolean) ?? null
  const commentTask = /clickup/i.test(call?.service ?? '') ? draft.target : null
  return outgoingFooter(
    {
      task: context.task ?? null,
      project,
      chatName: context.chatName ?? null,
      ref: outgoingRef(draft.id)
    },
    commentTask
  )
}
