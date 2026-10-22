// Custom build (hq-mail-intake): Orca+'s only door to Gmail — connect, status, and the read-only calls
// the mail intake makes. Nothing else in the app knows the Gmail API.
import type { GmailStatus } from '../../shared/gmail-types'
import type { HqMail } from '../../shared/hq-mail-events'
import {
  clearGmailRefreshToken,
  gmailAccount,
  hasGmailClient,
  loadGmailClient,
  loadGmailRefreshToken,
  parseGmailClientFile,
  saveGmailClient,
  saveGmailRefreshToken
} from './gmail-credential-store'
import { gmailMessageToMail } from './gmail-message'
import { authorizeGmail, refreshGoogleToken } from './gmail-oauth'

const API = 'https://gmail.googleapis.com/gmail/v1/users/me'
// Why: a token used within its last minute can expire mid-request.
const EXPIRY_MARGIN_MS = 60_000
// Why: the largest page messages.list serves.
const PAGE_MAX = 500

let access: { token: string; expiresAt: number } | null = null
let lastError: string | null = null

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function getGmailStatus(): GmailStatus {
  const email = gmailAccount()
  return { clientSet: hasGmailClient(), connected: email !== null, email, error: lastError }
}

export function importGmailClient(text: string): { ok: true } | { ok: false; error: string } {
  const client = parseGmailClientFile(text)
  if (!client) {
    return {
      ok: false,
      error:
        'This is not an OAuth client file. Download the Desktop app client JSON from Google Cloud Console → Credentials.'
    }
  }
  const previous = loadGmailClient()
  saveGmailClient(client)
  // Why: a refresh token works only with the client that issued it.
  if (previous && previous.clientId !== client.clientId) {
    disconnectGmail()
  }
  return { ok: true }
}

async function accessToken(): Promise<string> {
  if (access && access.expiresAt - EXPIRY_MARGIN_MS > Date.now()) {
    return access.token
  }
  const client = loadGmailClient()
  const refreshToken = loadGmailRefreshToken()
  if (!client || !refreshToken) {
    throw new Error('Gmail is not connected.')
  }
  const tokens = await refreshGoogleToken(client, refreshToken)
  access = { token: tokens.accessToken, expiresAt: tokens.expiresAt }
  return access.token
}

async function gmailGet(path: string, params: Record<string, string> = {}): Promise<unknown> {
  const url = new URL(`${API}${path}`)
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value)
  }
  const call = async (): Promise<Response> =>
    fetch(url, { headers: { Authorization: `Bearer ${await accessToken()}` } })
  let response = await call()
  if (response.status === 401) {
    access = null
    response = await call()
  }
  if (!response.ok) {
    throw new Error(`Gmail ${response.status}: ${(await response.text()).slice(0, 200)}`)
  }
  return response.json()
}

export async function connectGmail(
  openUrl: (url: string) => Promise<void>
): Promise<{ ok: true; email: string } | { ok: false; error: string }> {
  const client = loadGmailClient()
  if (!client) {
    return { ok: false, error: 'Choose the OAuth client file first.' }
  }
  try {
    const tokens = await authorizeGmail(client, openUrl)
    if (!tokens.refreshToken) {
      return {
        ok: false,
        error:
          'Google returned no refresh token; remove Orca+ from your Google account access and connect again.'
      }
    }
    access = { token: tokens.accessToken, expiresAt: tokens.expiresAt }
    const profile = await gmailGet('/profile')
    const email: unknown =
      profile && typeof profile === 'object' ? Reflect.get(profile, 'emailAddress') : null
    if (typeof email !== 'string' || !email) {
      return { ok: false, error: 'Gmail did not say whose mailbox this is.' }
    }
    saveGmailRefreshToken(tokens.refreshToken, email)
    lastError = null
    return { ok: true, email }
  } catch (error) {
    return { ok: false, error: errorText(error) }
  }
}

export function disconnectGmail(): void {
  clearGmailRefreshToken()
  access = null
  lastError = null
}

/** Ids of messages matching a Gmail search, newest first, page after page up to `max`. */
export async function listGmailMessageIds(query: string, max: number): Promise<string[]> {
  try {
    const ids: string[] = []
    let pageToken: unknown = null
    do {
      const result = await gmailGet('/messages', {
        q: query,
        maxResults: String(Math.min(PAGE_MAX, max - ids.length)),
        ...(typeof pageToken === 'string' ? { pageToken } : {})
      })
      const messages: unknown =
        result && typeof result === 'object' ? Reflect.get(result, 'messages') : null
      for (const message of Array.isArray(messages) ? messages : []) {
        const id: unknown =
          message && typeof message === 'object' ? Reflect.get(message, 'id') : null
        if (typeof id === 'string') {
          ids.push(id)
        }
      }
      pageToken = result && typeof result === 'object' ? Reflect.get(result, 'nextPageToken') : null
    } while (typeof pageToken === 'string' && pageToken && ids.length < max)
    lastError = null
    return ids
  } catch (error) {
    lastError = errorText(error)
    throw error
  }
}

export async function getGmailMail(id: string): Promise<HqMail | null> {
  return gmailMessageToMail(
    await gmailGet(`/messages/${encodeURIComponent(id)}`, { format: 'full' })
  )
}
