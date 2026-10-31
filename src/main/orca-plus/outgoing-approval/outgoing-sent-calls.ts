// Custom build (hq-request-ledger): which finished tool calls messaged a person and where the message
// landed, read from the PostToolUse payload — the tool, its input and its result. The place and the id
// come from the result, so a DM opened by user id lands in its D… channel and a new top-level line in
// its own thread. Slack and Gmail keep the ids their ledger readers use, so a message read back later
// is the same row; ClickUp comments and MR notes are prefixed (`comment:`, `note:`).
import { hqPlaceKey } from '../../../shared/hq-ledger'
import {
  mcpToolTokens,
  parseMcpToolName
} from '../../../shared/outgoing-approval/outgoing-mcp-rules'
import { glabNoteMessages } from './outgoing-sent-glab'
import {
  field,
  inputText,
  num,
  parseJsonText,
  responseText,
  sentMessage as message,
  str,
  type OutgoingSentMessage,
  type RepoOfCwd
} from './outgoing-sent-fields'

export type { OutgoingSentMessage, RepoOfCwd } from './outgoing-sent-fields'

export type OutgoingSentHook = {
  toolName: string
  toolInput: Record<string, unknown>
  toolResponse: unknown
  /** The provider's session id and tool-call id, which name a held call. */
  sessionId: string | null
  toolUseId: string | null
  cwd: string | null
}

const SLACK_CHANNEL = /^[CDG][A-Z0-9]{6,}$/
const SLACK_TS = /^\d{9,}\.\d+$/

/** A finished call's PostToolUse payload; null for a failure or another event. */
export function readOutgoingSentHook(payload: unknown): OutgoingSentHook | null {
  const toolName = str(field(payload, 'tool_name'))
  const input = field(payload, 'tool_input')
  const response = field(payload, 'tool_response')
  if (
    str(field(payload, 'hook_event_name')) !== 'PostToolUse' ||
    !toolName ||
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    response === undefined ||
    field(response, 'isError') === true ||
    field(response, 'is_error') === true
  ) {
    return null
  }
  return {
    toolName,
    toolInput: Object.fromEntries(Object.entries(input)),
    toolResponse: response,
    sessionId: str(field(payload, 'session_id')),
    toolUseId: str(field(payload, 'tool_use_id')),
    cwd: str(field(payload, 'cwd'))
  }
}

function slackMessage(hook: OutgoingSentHook, verbs: string[]): OutgoingSentMessage | null {
  if (
    verbs.includes('draft') ||
    verbs.includes('schedule') ||
    !verbs.some((verb) => verb === 'send' || verb === 'reply' || verb === 'post')
  ) {
    return null
  }
  const json = parseJsonText(responseText(hook.toolResponse))
  const context = field(json, 'message_context')
  const posted = field(json, 'message')
  const link = str(field(json, 'message_link')) ?? str(field(json, 'permalink'))
  const channel =
    str(field(context, 'channel_id')) ??
    str(field(json, 'channel')) ??
    str(field(json, 'channel_id'))
  const ts = str(field(context, 'message_ts')) ?? str(field(json, 'ts')) ?? str(field(posted, 'ts'))
  if (!channel || !SLACK_CHANNEL.test(channel) || !ts || !SLACK_TS.test(ts)) {
    return null
  }
  let linked: string | null = null
  try {
    linked = link ? new URL(link).searchParams.get('thread_ts') : null
  } catch {
    linked = null
  }
  const thread = [
    linked,
    str(field(posted, 'thread_ts')),
    inputText(hook.toolInput, 'thread_ts')
  ].find((candidate): candidate is string => !!candidate && SLACK_TS.test(candidate))
  return message(
    `slack:${channel}:${thread ?? ts}`,
    ts,
    inputText(hook.toolInput, 'message', 'text'),
    {
      at: Math.round(Number(ts) * 1000),
      link
    }
  )
}

function clickUpComment(hook: OutgoingSentHook, verbs: string[]): OutgoingSentMessage | null {
  if (
    !verbs.includes('comment') ||
    verbs.includes('chat') ||
    !verbs.some((verb) => ['create', 'add', 'post', 'reply'].includes(verb))
  ) {
    return null
  }
  const input = hook.toolInput
  const entity = inputText(input, 'entity_type') ?? 'task'
  const task =
    inputText(input, 'task_id') ?? (entity === 'task' ? inputText(input, 'entity_id') : null)
  const json = parseJsonText(responseText(hook.toolResponse))
  const id = str(field(json, 'comment_id')) ?? str(field(json, 'id'))
  if (!task || !id || field(json, 'success') === false) {
    return null
  }
  return message(
    `clickup:${task}`,
    `comment:${id}`,
    inputText(input, 'comment_text', 'comment', 'text')
  )
}

const MR_NOTE_WORDS = ['note', 'notes', 'comment', 'discussion', 'thread', 'reply']

function gitLabMcpNote(hook: OutgoingSentHook, verbs: string[]): OutgoingSentMessage | null {
  const onMr =
    (verbs.includes('merge') && verbs.includes('request')) ||
    verbs.includes('mr') ||
    verbs.includes('mrs')
  if (
    !onMr ||
    verbs.includes('draft') ||
    !verbs.some((verb) => MR_NOTE_WORDS.includes(verb)) ||
    !verbs.some((verb) => ['create', 'add', 'post', 'reply', 'new'].includes(verb))
  ) {
    return null
  }
  const input = hook.toolInput
  const text = responseText(hook.toolResponse)
  const json = parseJsonText(text)
  const result = field(json, 'result') ?? json
  const note = field(field(result, 'notes'), '0') ?? result
  const id = num(field(note, 'id'))
  if (!id) {
    return null
  }
  const url = /https?:\/\/\S+?\/-\/merge_requests\/\d+/.exec(text)?.[0] ?? null
  const project = inputText(input, 'project_id', 'project', 'project_path', 'path_with_namespace')
  const iid =
    num(field(input, 'merge_request_iid')) ??
    num(field(input, 'mr_iid')) ??
    num(field(input, 'iid')) ??
    num(field(note, 'noteable_iid'))
  const key =
    (url ? hqPlaceKey(url) : null) ??
    (project && project.includes('/') && iid ? `gitlab:${project}!${iid}` : null)
  if (!key) {
    return null
  }
  const body =
    str(field(note, 'body')) ?? inputText(input, 'body', 'note', 'comment', 'message', 'text')
  return message(key, `note:${id}`, body, { link: url ? `${url}#note_${id}` : null })
}

function gmailLetter(hook: OutgoingSentHook, verbs: string[]): OutgoingSentMessage | null {
  if (
    verbs.includes('draft') ||
    !verbs.some((verb) => verb === 'send' || verb === 'reply' || verb === 'forward')
  ) {
    return null
  }
  const json = parseJsonText(responseText(hook.toolResponse))
  const sent = field(json, 'message') ?? json
  const thread =
    str(field(sent, 'threadId')) ?? str(field(sent, 'thread_id')) ?? str(field(json, 'threadId'))
  const id =
    str(field(sent, 'id')) ?? str(field(sent, 'messageId')) ?? str(field(json, 'messageId'))
  if (!thread || !id) {
    return null
  }
  const input = hook.toolInput
  return message(
    `gmail:${thread}`,
    id,
    inputText(input, 'body', 'text', 'content', 'message', 'html_body'),
    { title: inputText(input, 'subject') }
  )
}

function mcpMessage(hook: OutgoingSentHook): OutgoingSentMessage | null {
  const mcp = parseMcpToolName(hook.toolName)
  if (!mcp) {
    return null
  }
  const verbs = mcpToolTokens(mcp.tool)
  if (/slack/i.test(mcp.server)) {
    return slackMessage(hook, verbs)
  }
  if (/clickup/i.test(mcp.server)) {
    return clickUpComment(hook, verbs)
  }
  if (/gitlab/i.test(mcp.server)) {
    return gitLabMcpNote(hook, verbs)
  }
  return /gmail/i.test(mcp.server) ? gmailLetter(hook, verbs) : null
}

/** The messages a finished call put in front of people, from its result; none when it sent none.
 *  A Bash call may post several MR notes. */
export async function outgoingSentMessages(
  hook: OutgoingSentHook,
  repoOfCwd: RepoOfCwd
): Promise<OutgoingSentMessage[]> {
  if (hook.toolName === 'Bash') {
    return glabNoteMessages(
      { command: inputText(hook.toolInput, 'command'), response: hook.toolResponse, cwd: hook.cwd },
      repoOfCwd
    )
  }
  const message = mcpMessage(hook)
  return message ? [message] : []
}

/** The first of them; null when the call sent none. */
export async function outgoingSentMessage(
  hook: OutgoingSentHook,
  repoOfCwd: RepoOfCwd
): Promise<OutgoingSentMessage | null> {
  return (await outgoingSentMessages(hook, repoOfCwd))[0] ?? null
}
