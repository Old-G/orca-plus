import { ensureElectronProxyFromEnvironment } from '../network/proxy-settings'
import { getMainHttpClient } from '../network/http-client'
import { withSpan } from '../observability/tracer'

const SLACK_API_BASE_URL = 'https://slack.com/api'
const REQUEST_TIMEOUT_MS = 30_000
const MAX_CONCURRENT = 4
// Why: Slack's per-method tier limits answer 429 with Retry-After; one bounded wait covers a burst.
const MAX_RETRY_AFTER_MS = 30_000

// Why: these mean the saved token itself is unusable, not that one call was refused.
const AUTH_ERRORS = new Set(['invalid_auth', 'not_authed', 'account_inactive', 'token_revoked'])

export class SlackApiError extends Error {
  code: string

  constructor(code: string, message?: string) {
    super(message ?? describeSlackError(code))
    this.name = 'SlackApiError'
    this.code = code
  }
}

export function isSlackAuthError(error: unknown): boolean {
  return error instanceof SlackApiError && AUTH_ERRORS.has(error.code)
}

export function describeSlackError(code: string): string {
  switch (code) {
    case 'invalid_auth':
    case 'not_authed':
    case 'token_revoked':
    case 'account_inactive':
      return 'Slack rejected the token. Reconnect Slack with a valid token.'
    case 'missing_scope':
      return 'The Slack app is missing a permission. Recreate it from the Orca+ manifest and reinstall.'
    case 'user_not_found':
      return 'Slack has no user with that member ID in this workspace.'
    case 'channel_not_found':
      return 'Slack could not find that channel, or the bot is not a member of it.'
    case 'not_in_channel':
      return 'Invite the Orca+ bot to that channel first (/invite @orca-plus).'
    case 'not_allowed_token_type':
      return 'That token has the wrong type: the bot token starts with xoxb-, the app token with xapp-.'
    case 'ratelimited':
      return 'Slack rate limit reached. Try again in a minute.'
    default:
      return `Slack request failed: ${code}`
  }
}

export function asSlackRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : {}
}

let running = 0
const waiting: (() => void)[] = []

async function acquireSlot(): Promise<void> {
  if (running < MAX_CONCURRENT) {
    running += 1
    return
  }
  await new Promise<void>((resolve) => waiting.push(resolve))
  running += 1
}

function releaseSlot(): void {
  running -= 1
  waiting.shift()?.()
}

// Why form encoding: every Web API method accepts it, while several read methods ignore JSON bodies.
function encodeSlackArgs(args: Record<string, unknown>): URLSearchParams {
  const body = new URLSearchParams()
  for (const [key, value] of Object.entries(args)) {
    if (value === undefined || value === null) {
      continue
    }
    body.set(key, typeof value === 'string' ? value : JSON.stringify(value))
  }
  return body
}

async function sendOnce(
  url: string,
  token: string,
  args: Record<string, unknown>
): Promise<Response> {
  const httpClient = getMainHttpClient()
  const proxySession = httpClient.proxySession()
  await ensureElectronProxyFromEnvironment({
    ...(proxySession ? { proxySession } : {}),
    probeUrl: url
  }).catch(() => undefined)
  return httpClient.fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8'
    },
    body: encodeSlackArgs(args).toString(),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  })
}

function retryAfterMs(response: Response): number {
  const seconds = Number(response.headers.get('retry-after'))
  return Number.isFinite(seconds) && seconds > 0
    ? Math.min(seconds * 1000, MAX_RETRY_AFTER_MS)
    : 1000
}

/** Calls one Web API method; resolves to the body when Slack answers `ok: true`. */
export async function slackRequest(
  token: string,
  method: string,
  args: Record<string, unknown> = {}
): Promise<Record<string, unknown>> {
  const url = `${SLACK_API_BASE_URL}/${method}`
  await acquireSlot()
  try {
    return await withSpan(
      'slack.request',
      async () => {
        let response = await sendOnce(url, token, args)
        if (response.status === 429) {
          await new Promise((resolve) => setTimeout(resolve, retryAfterMs(response)))
          response = await sendOnce(url, token, args)
        }
        if (response.status === 429) {
          throw new SlackApiError('ratelimited')
        }
        if (!response.ok) {
          throw new SlackApiError(`http_${response.status}`)
        }
        const body = asSlackRecord(await response.json())
        if (body.ok !== true) {
          throw new SlackApiError(typeof body.error === 'string' ? body.error : 'unknown_error')
        }
        return body
      },
      { kind: 'client' }
    )
  } finally {
    releaseSlot()
  }
}
