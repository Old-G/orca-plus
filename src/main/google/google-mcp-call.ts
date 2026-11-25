// Custom build (google-mcp): from 1 February 2027 Google lets AI agents reach Workspace data only
// through its MCP servers. One tool call there, as the account the call acts as: Streamable HTTP,
// JSON-RPC `tools/call`, stateless (Google's servers need no `initialize`). Google answers JSON, or
// one event stream; a refusal comes as an HTTP status with the tool result marked `isError`.
import type { GoogleService } from '../../shared/google/google-scopes'
import { GOOGLE_SERVICE_INFO } from '../../shared/google/google-scopes'

export const GOOGLE_MCP_SERVICES = ['gmail', 'calendar', 'drive', 'docs', 'sheets'] as const
export type GoogleMcpService = (typeof GOOGLE_MCP_SERVICES)[number] & GoogleService

/** Google's own MCP API name for a service, the one the Console turns on. */
export const googleMcpApiName = (service: GoogleMcpService): string =>
  `${service}mcp.googleapis.com`

export const googleMcpEndpoint = (service: GoogleMcpService): string =>
  `https://${googleMcpApiName(service)}/mcp/v1`

export type GoogleMcpRequest = {
  method: 'POST'
  url: string
  body: string
  contentType: string
  accept: string
}

export type GoogleMcpFailure = { message: string; status?: number }

const ACCEPT = 'application/json, text/event-stream'
const DETAIL_MAX = 300

let nextId = 1

type RpcMessage = {
  result?: { isError?: boolean; structuredContent?: unknown; content?: unknown }
  error?: { message?: unknown }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function parseJson(text: string): unknown {
  try {
    const parsed: unknown = JSON.parse(text)
    return parsed
  } catch {
    return null
  }
}

/** The JSON-RPC answer: the body itself, or the last message of an event stream that has one. */
export function readGoogleMcpMessage(text: string): RpcMessage | null {
  const whole = parseJson(text)
  if (isRecord(whole) && ('result' in whole || 'error' in whole)) {
    return whole as RpcMessage
  }
  let found: RpcMessage | null = null
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith('data:')) {
      continue
    }
    const message = parseJson(line.slice('data:'.length).trim())
    if (isRecord(message) && ('result' in message || 'error' in message)) {
      found = message as RpcMessage
    }
  }
  return found
}

/** The text parts of a tool result, joined. */
function contentText(content: unknown): string {
  if (!Array.isArray(content)) {
    return ''
  }
  return content
    .map((part) => (isRecord(part) && part.type === 'text' ? String(part.text ?? '') : ''))
    .filter(Boolean)
    .join('\n')
}

/** A tool's answer: its structured content, else its text read as JSON, else the text itself. */
function toolValue(result: NonNullable<RpcMessage['result']>): unknown {
  if (result.structuredContent !== undefined) {
    return result.structuredContent
  }
  const text = contentText(result.content)
  return parseJson(text) ?? text
}

/** What Google said, as plain words: an API error's own message when the text is one. */
const oneLine = (text: string): string => {
  const json = parseJson(text)
  const said =
    isRecord(json) && isRecord(json.error) && typeof json.error.message === 'string'
      ? json.error.message
      : isRecord(json) && typeof json.message === 'string'
        ? json.message
        : text
  const flat = said.replace(/\s+/g, ' ').trim()
  return flat.length > DETAIL_MAX ? `${flat.slice(0, DETAIL_MAX - 1)}…` : flat
}

/** Google's refusal as one sentence that says what to do. */
export function googleMcpFailureSentence(
  service: GoogleMcpService,
  status: number,
  detail: string,
  projectId: string | undefined
): string {
  const label = GOOGLE_SERVICE_INFO[service].label
  if (status === 401) {
    return 'Google refused the sign-in. Ask your owner to reconnect it in Orca.'
  }
  if (status === 429 || /quota|rate limit/i.test(detail)) {
    return 'Google says too many requests right now. Wait a minute and try again.'
  }
  if (status === 403 && /has not been used|is disabled|SERVICE_DISABLED/i.test(detail)) {
    const project = projectId ? `?project=${encodeURIComponent(projectId)}` : ''
    return `Google's ${label} MCP server is turned off for this app. Ask your owner to turn it on: https://console.cloud.google.com/apis/library/${googleMcpApiName(service)}${project}`
  }
  if (status === 403 && /ACCESS_TOKEN_SCOPE_INSUFFICIENT|insufficient.{0,40}scope/i.test(detail)) {
    return 'Google access for this was not allowed. Ask your owner to reconnect it in Orca and allow it.'
  }
  if (status === 404) {
    return 'Google found nothing there.'
  }
  const said = oneLine(detail)
  if (said) {
    return `Google refused: ${said}`
  }
  return status >= 200 && status < 300
    ? 'Google refused this request.'
    : `Google refused: HTTP ${status}`
}

/**
 * Calls one tool and returns what `read` makes of its answer. `call` sends the request with the
 * account's token (renewing it once on a 401); a refusal is thrown through `fail` as a sentence.
 */
export async function callGoogleMcpTool<T>(
  call: (request: GoogleMcpRequest) => Promise<Response>,
  fail: (failure: GoogleMcpFailure) => never,
  args: {
    service: GoogleMcpService
    tool: string
    arguments: Record<string, unknown>
    read: (value: unknown) => T | null
    projectId?: string
  }
): Promise<T> {
  const response = await call({
    method: 'POST',
    url: googleMcpEndpoint(args.service),
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: nextId++,
      method: 'tools/call',
      params: { name: args.tool, arguments: args.arguments }
    }),
    contentType: 'application/json',
    accept: ACCEPT
  })
  // A stream Google holds open past the request's timeout ends here, not as a raw abort.
  const text = await response
    .text()
    .catch((): never => fail({ message: "Couldn't reach Google. Try again in a moment." }))
  const message = readGoogleMcpMessage(text)
  const refuse = (detail: string): never =>
    fail({
      message: googleMcpFailureSentence(args.service, response.status, detail, args.projectId),
      status: response.status
    })
  if (!message) {
    return response.ok
      ? fail({ message: 'Google answered in a shape Orca does not understand.' })
      : refuse('')
  }
  if (message.error) {
    return refuse(String(message.error.message ?? ''))
  }
  const result = message.result
  if (!result || result.isError || !response.ok) {
    return refuse(result ? contentText(result.content) : '')
  }
  const value = args.read(toolValue(result))
  if (value === null) {
    return fail({ message: 'Google answered in a shape Orca does not understand.' })
  }
  return value
}
