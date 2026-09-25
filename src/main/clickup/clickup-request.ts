import { ensureElectronProxyFromEnvironment } from '../network/proxy-settings'
import { getMainHttpClient } from '../network/http-client'
import { withSpan } from '../observability/tracer'
import { asClickUpRecord } from './clickup-task-mapping'

export const CLICKUP_API_BASE_URL = 'https://api.clickup.com/api/v2'
const REQUEST_TIMEOUT_MS = 30_000
// Why: ClickUp rate-limits per token (100 req/min on most plans); a small cap
// keeps paged list reads from bursting through it.
const MAX_CONCURRENT = 4

export class ClickUpApiError extends Error {
  status: number | null
  code: string | null

  constructor(message: string, status: number | null = null, code: string | null = null) {
    super(message)
    this.name = 'ClickUpApiError'
    this.status = status
    this.code = code
  }
}

// Why: ClickUp answers 401 both for a bad token and for a task/workspace the
// token cannot see; only the former means the saved credential is invalid.
const ACCESS_DENIED_CODES = new Set(['OAUTH_023', 'OAUTH_026', 'OAUTH_027'])

export function isClickUpAccessDenied(error: unknown): boolean {
  return (
    error instanceof ClickUpApiError &&
    error.status === 401 &&
    error.code !== null &&
    ACCESS_DENIED_CODES.has(error.code)
  )
}

export function isClickUpAuthError(error: unknown): boolean {
  return error instanceof ClickUpApiError && error.status === 401 && !isClickUpAccessDenied(error)
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

async function readClickUpError(response: Response): Promise<ClickUpApiError> {
  let message = ''
  let code: string | null = null
  try {
    const raw = asClickUpRecord(await response.json())
    message = typeof raw.err === 'string' ? raw.err : ''
    code = typeof raw.ECODE === 'string' ? raw.ECODE : null
  } catch {
    // Fall through to the status text.
  }
  if (response.status === 401 && !(code && ACCESS_DENIED_CODES.has(code))) {
    message = 'ClickUp rejected the API token. Reconnect ClickUp with a valid personal token.'
  } else if (response.status === 429) {
    message = 'ClickUp rate limit reached. Try again in a minute.'
  }
  return new ClickUpApiError(
    message || response.statusText || `ClickUp request failed (${response.status})`,
    response.status,
    code
  )
}

/** Resolves to the raw JSON body; callers narrow it through clickup-task-mapping. */
export async function clickUpRequest(
  token: string,
  path: string,
  init: RequestInit = {}
): Promise<unknown> {
  const url = `${CLICKUP_API_BASE_URL}${path}`
  await acquireSlot()
  try {
    return await withSpan(
      'clickup.request',
      async () => {
        const httpClient = getMainHttpClient()
        const proxySession = httpClient.proxySession()
        await ensureElectronProxyFromEnvironment({
          ...(proxySession ? { proxySession } : {}),
          probeUrl: url
        }).catch(() => undefined)
        const headers = new Headers(init.headers)
        headers.set('Accept', 'application/json')
        headers.set('Content-Type', 'application/json')
        // Why: personal tokens (pk_…) go in the header as-is, without "Bearer".
        headers.set('Authorization', token)
        const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
        const response = await httpClient.fetch(url, {
          ...init,
          headers,
          signal: init.signal ? AbortSignal.any([init.signal, timeout]) : timeout
        })
        if (!response.ok) {
          throw await readClickUpError(response)
        }
        if (response.status === 204) {
          return null
        }
        const body: unknown = await response.json()
        return body
      },
      { kind: 'client' }
    )
  } finally {
    releaseSlot()
  }
}
