// Custom build (outgoing-approval): which MCP tool calls message a person or delete something for good.
// Every other write passes (owner's call, 02.10.2026).
import type { PulseDraftKind } from '../pulse-types'
import { MAX_OUTGOING_BODY_LENGTH, type OutgoingAction } from './outgoing-action'
import { heldClickUpOperatorCall } from './outgoing-clickup-operator-rules'
import { rewritesClickUpTaskText } from './outgoing-clickup-text-rules'

// Why: local or private-only servers — the IDE bridge, browser automation (not covered in v1)
// and Claude Docs, which stay private until shared.
const EXEMPT_SERVERS = [
  /^ide$/,
  /^claude-in-chrome$/,
  /^plugin_playwright_/,
  /^claude_ai_Claude_Docs$/
]

// Why: matched as whole name tokens, so `get_task_comments` or `download_task_attachment` stay reads.
const MESSAGE_TOKENS = new Set(['send', 'reply', 'forward', 'schedule', 'notify', 'invite', 'hand'])

const DELETE_TOKENS = new Set(['delete', 'destroy', 'purge', 'wipe', 'erase'])

// Why: a leading read verb wins over later tokens — `getTicketComment`, `get_file_upload_url` are reads.
const READ_LEADS = new Set([
  'check',
  'count',
  'describe',
  'download',
  'fetch',
  'filter',
  'find',
  'get',
  'list',
  'lookup',
  'query',
  'read',
  'resolve',
  'search',
  'show',
  'view'
])

const BODY_KEYS = [
  'message',
  'text',
  'comment_text',
  'comment',
  'content',
  'body',
  'markdown_description',
  'markdown_content',
  'description',
  'html_content',
  'reply',
  'name',
  'title'
]

const TARGET_KEYS = [
  'channel_id',
  'channel',
  'user_id',
  'users',
  'to',
  'recipient',
  'email',
  'task_id',
  'list_id',
  'ticket_id',
  'ticketId',
  'thread_id',
  'event_id',
  'id'
]

export type McpToolName = { server: string; tool: string }

export function parseMcpToolName(name: string): McpToolName | null {
  const match = /^mcp__(.+?)__(.+)$/.exec(name)
  return match ? { server: match[1], tool: match[2] } : null
}

export function mcpToolTokens(tool: string): string[] {
  return tool
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
}

export function classifyMcpCall(name: McpToolName, input: unknown): OutgoingAction | null {
  if (EXEMPT_SERVERS.some((pattern) => pattern.test(name.server))) {
    return null
  }
  const tokens = mcpToolTokens(name.tool)
  if (tokens.includes('authenticate') || tokens.includes('authentication')) {
    return null
  }
  const service = name.server.replace(/^claude_ai_/, '').replace(/_+/g, ' ')
  const verbs = tokens.length > 1 && isServiceToken(tokens[0], service) ? tokens.slice(1) : tokens
  if (READ_LEADS.has(verbs[0])) {
    return null
  }
  const held =
    verbs.some((token) => DELETE_TOKENS.has(token)) ||
    messagesAPerson(name.server, verbs, input) ||
    rewritesClickUpTaskText(name.server, name.tool, input) ||
    heldClickUpOperatorCall(name.server, name.tool, input)
  if (!held) {
    return null
  }
  const bodyKey = BODY_KEYS.find((key) => typeof readField(input, key) === 'string')
  const body = bodyKey ? String(readField(input, bodyKey)) : compactJson(input)
  return {
    service,
    operation: verbs.join(' '),
    draftKind: draftKindFor(service, tokens),
    target: readTarget(input),
    body: body.slice(0, MAX_OUTGOING_BODY_LENGTH),
    editField: bodyKey ?? null
  }
}

/** A draft is not sent; a ticket comment reaches the customer only when public; an event only with attendees. */
function messagesAPerson(server: string, verbs: string[], input: unknown): boolean {
  if (verbs.includes('draft')) {
    return false
  }
  if (verbs.some((token) => MESSAGE_TOKENS.has(token))) {
    return true
  }
  const writes = verbs.includes('create') || verbs.includes('update')
  if (/zoho/i.test(server) && writes && verbs.includes('comment')) {
    return readField(input, 'isPublic') === true
  }
  if (writes && verbs.includes('event')) {
    const attendees = readField(input, 'attendees')
    return Array.isArray(attendees) && attendees.length > 0
  }
  return false
}

function isServiceToken(token: string, service: string): boolean {
  return service.toLowerCase().replace(/\s+/g, '').startsWith(token)
}

function draftKindFor(service: string, tokens: string[]): PulseDraftKind {
  const clickUp = /clickup/i.test(service)
  if (clickUp && tokens.includes('comment')) {
    return 'clickup-comment'
  }
  if (clickUp && tokens.includes('create') && tokens.includes('task')) {
    return 'clickup-task'
  }
  if (['send', 'reply', 'forward', 'schedule'].some((token) => tokens.includes(token))) {
    return 'message'
  }
  return 'other'
}

function readField(input: unknown, key: string): unknown {
  return input && typeof input === 'object' ? Reflect.get(input, key) : undefined
}

function readTarget(input: unknown): string | null {
  for (const key of TARGET_KEYS) {
    const value = readField(input, key)
    if (typeof value === 'string' && value.trim()) {
      return value.trim()
    }
    if (Array.isArray(value) && value.length > 0) {
      return value.map((entry) => String(entry)).join(', ')
    }
  }
  return null
}

function compactJson(input: unknown): string {
  try {
    return JSON.stringify(input ?? {}, null, 2)
  } catch {
    return ''
  }
}
