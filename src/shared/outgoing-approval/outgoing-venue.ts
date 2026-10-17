// Custom build (outgoing-venue): where else a held message could go — the ClickUp task it is about
// instead of Slack, Slack instead of a task comment, or a thread this chat already has in the channel —
// offered on the card for the owner to pick. Nothing moves on its own.
import { readInputString } from './outgoing-action'
import type { OutgoingTaskRef } from './outgoing-footer'
import type { PulseDecision, PulseDraft, PulseWaiting } from '../pulse-types'
import { parseSlackThreadRef } from '../hq-waiting-replies'

export type OutgoingMove =
  | { to: 'clickup'; task: OutgoingTaskRef }
  | { to: 'slack'; task: OutgoingTaskRef | null }

export type OutgoingThreadChoice = {
  ts: string
  /** When the thread started or was last written in, ms. */
  at: number
  /** A few words of what was said there. */
  said: string
}

const SAID_MAX = 60
const THREADS_MAX = 3
// Why: past a week a thread is a new conversation, not one to continue.
const THREAD_AGE_MS = 7 * 24 * 60 * 60_000

function isSlackMessage(draft: PulseDraft): boolean {
  const call = draft.call
  return Boolean(
    call && /slack/i.test(call.service) && /\b(send|reply|schedule)\b/.test(call.operation)
  )
}

function isClickUpComment(draft: PulseDraft): boolean {
  const call = draft.call
  return Boolean(call && /clickup/i.test(call.service) && /\bcomment\b/.test(call.operation))
}

export function outgoingMove(draft: PulseDraft, task: OutgoingTaskRef | null): OutgoingMove | null {
  if (isSlackMessage(draft) && task) {
    return { to: 'clickup', task }
  }
  return isClickUpComment(draft) ? { to: 'slack', task } : null
}

function quoted(text: string): string {
  return `"""\n${text.replaceAll('"""', '"​""')}\n"""`
}

/** What the agent is told instead of running the call: send the same text where the owner chose. */
export function outgoingMoveReason(move: OutgoingMove, text: string): string {
  if (move.to === 'clickup') {
    const where = move.task.url ? `${move.task.id} (${move.task.url})` : move.task.id
    return [
      `The user chose to ask this in ClickUp task ${where} instead of Slack. Do not send the Slack message.`,
      `Post the text below as a comment on that task with clickup_create_comment (entity_id ${move.task.id})`,
      'and @mention the person it was for as [@Name](#user_mention#<their ClickUp user id from',
      'clickup_resolve_assignees>). Change nothing else in the text. Orca+ lets that comment through',
      'without a second Approve. The text:',
      quoted(text)
    ].join('\n')
  }
  const about = move.task
    ? ` Add the task link ${move.task.url ?? move.task.id} so they know what it is about.`
    : ''
  return [
    'The user chose to send this in Slack instead of a ClickUp comment. Do not post the comment.',
    `Send the text below as a Slack DM to the person it was for (their user id from slack_search_users).${about}`,
    'Change nothing else in the text. Orca+ lets that message through without a second Approve. The text:',
    quoted(text)
  ].join('\n')
}

export type MovedTextAllowance = {
  /** ClickUp @mentions (`[@Name](#user_mention#id)`) the agent was told to add. */
  mentions: boolean
  /** Links the agent was told to add, such as the task link. */
  links: readonly string[]
}

const MENTION_TARGET = /^#user_mention#\d+$/
// Why: a moved message carries the approved words; a few more (a greeting, «по задаче») are fine.
const EXTRA_WORDS_MIN = 6
const EXTRA_WORDS_SHARE = 0.15

/** Every URL and markdown link target in the text, trailing punctuation dropped. */
function links(text: string): string[] {
  const targets = [...text.matchAll(/\]\(([^)\s]*)\)/g)].map((match) => match[1])
  const urls = [...text.matchAll(/https?:\/\/[^\s<>()[\]]+/g)].map((match) => match[0])
  return [...targets, ...urls].map((link) => link.replace(/[.,;:!?]+$/, ''))
}

function words(text: string): string[] {
  return text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, ' ')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length > 1)
}

/**
 * True when a new call carries the moved text and nothing it was not approved with: nearly all its
 * words, a few extra at most, and no link but the approved text's own and the allowed ones.
 */
export function carriesMovedText(
  moved: string,
  candidate: string,
  allowed: MovedTextAllowance
): boolean {
  const approvedLinks = new Set(links(moved))
  const strayLink = links(candidate).some(
    (link) =>
      !approvedLinks.has(link) &&
      !allowed.links.includes(link) &&
      !(allowed.mentions && MENTION_TARGET.test(link))
  )
  const want = words(moved)
  if (strayLink || want.length === 0) {
    return false
  }
  const pool = new Map<string, number>()
  for (const word of words(candidate)) {
    pool.set(word, (pool.get(word) ?? 0) + 1)
  }
  let found = 0
  for (const word of want) {
    const left = pool.get(word) ?? 0
    if (left > 0) {
      pool.set(word, left - 1)
      found += 1
    }
  }
  const extra = [...pool.values()].reduce((sum, left) => sum + left, 0)
  return (
    found / want.length >= 0.9 &&
    extra <= Math.max(EXTRA_WORDS_MIN, Math.ceil(want.length * EXTRA_WORDS_SHARE))
  )
}

function said(text: string | null): string {
  const line = (text ?? '').replace(/\s+/g, ' ').trim()
  return line.length > SAID_MAX ? `${line.slice(0, SAID_MAX - 1)}…` : line
}

/** Threads this chat already has in the channel a new top-level Slack message goes to, newest first. */
export function outgoingThreadChoices(
  draft: PulseDraft,
  decisions: readonly PulseDecision[],
  waitings: readonly PulseWaiting[],
  now: number
): OutgoingThreadChoice[] {
  const call = draft.call
  const channel = draft.target?.split(',')[0]?.trim() ?? ''
  if (!call?.agentSessionId || !isSlackMessage(draft) || !/^[CG]/.test(channel)) {
    return []
  }
  if (readInputString(call.toolInput, 'thread_ts')) {
    return []
  }
  const threads = new Map<string, OutgoingThreadChoice>()
  const add = (ts: string, at: number, text: string | null): void => {
    const known = threads.get(ts)
    if (now - at <= THREAD_AGE_MS && (!known || known.at < at)) {
      threads.set(ts, { ts, at, said: said(text) || (known?.said ?? '') })
    }
  }
  for (const decision of decisions) {
    const sent = decision.sentContext
    if (
      decision.outcome !== 'rejected' &&
      sent?.agentSessionId === call.agentSessionId &&
      sent.threadTs &&
      sent.targetId?.split(',')[0]?.trim() === channel
    ) {
      add(sent.threadTs, decision.decidedAt, decision.body)
    }
  }
  for (const waiting of waitings) {
    const thread = parseSlackThreadRef(waiting.sourceRef)
    if (waiting.agentSessionId === call.agentSessionId && thread?.channel === channel) {
      add(thread.threadTs, waiting.createdAt, waiting.title)
    }
  }
  return [...threads.values()].sort((a, b) => b.at - a.at).slice(0, THREADS_MAX)
}
