// Custom build (hq-mail-intake): Google sign-in for a Desktop app client — the browser opens Google's
// consent page, which redirects to a one-shot server on 127.0.0.1 with the code (PKCE, no secret kept
// in transit).
import { createHash, randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import type { GmailClient } from './gmail-credential-store'

export const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly'
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const SIGN_IN_TIMEOUT_MS = 5 * 60_000

export type GoogleTokens = { accessToken: string; refreshToken: string | null; expiresAt: number }

export function readGoogleTokens(raw: unknown, now: number): GoogleTokens {
  const record = raw && typeof raw === 'object' ? raw : {}
  const accessToken: unknown = Reflect.get(record, 'access_token')
  const refreshToken: unknown = Reflect.get(record, 'refresh_token')
  const expiresIn: unknown = Reflect.get(record, 'expires_in')
  if (typeof accessToken !== 'string' || !accessToken) {
    const error: unknown = Reflect.get(record, 'error_description') ?? Reflect.get(record, 'error')
    throw new Error(typeof error === 'string' ? error : 'Google returned no access token.')
  }
  return {
    accessToken,
    refreshToken: typeof refreshToken === 'string' && refreshToken ? refreshToken : null,
    expiresAt: now + (typeof expiresIn === 'number' ? expiresIn : 3600) * 1000
  }
}

async function exchange(params: Record<string, string>): Promise<GoogleTokens> {
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString()
  })
  return readGoogleTokens(await response.json().catch(() => null), Date.now())
}

export function refreshGoogleToken(
  client: GmailClient,
  refreshToken: string
): Promise<GoogleTokens> {
  return exchange({
    client_id: client.clientId,
    client_secret: client.clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token'
  })
}

const DONE_PAGE =
  '<!doctype html><meta charset="utf-8"><title>Orca+</title><body style="font:16px system-ui;padding:40px">Gmail is connected. You can close this tab and return to Orca+.</body>'

/** Opens Google's consent page and resolves with tokens once the owner allows read access. */
export async function authorizeGmail(
  client: GmailClient,
  openUrl: (url: string) => Promise<void>
): Promise<GoogleTokens> {
  const verifier = randomBytes(32).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  const state = randomBytes(16).toString('hex')
  const server = createServer()
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') {
    server.close()
    throw new Error('Could not open a local port for the Google sign-in.')
  }
  const redirectUri = `http://127.0.0.1:${address.port}`
  try {
    const code = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('Google sign-in was not finished within five minutes.')),
        SIGN_IN_TIMEOUT_MS
      )
      server.on('request', (request, response) => {
        const url = new URL(request.url ?? '/', redirectUri)
        if (url.pathname !== '/' || url.searchParams.get('state') !== state) {
          response.writeHead(404).end()
          return
        }
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(DONE_PAGE)
        clearTimeout(timer)
        const granted = url.searchParams.get('code')
        if (granted) {
          resolve(granted)
        } else {
          reject(
            new Error(`Google sign-in stopped: ${url.searchParams.get('error') ?? 'no code'}.`)
          )
        }
      })
      const auth = new URL(AUTH_URL)
      for (const [key, value] of Object.entries({
        client_id: client.clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: GMAIL_SCOPE,
        access_type: 'offline',
        // Why: without consent Google returns no refresh token for an app it has seen before.
        prompt: 'consent',
        code_challenge: challenge,
        code_challenge_method: 'S256',
        state
      })) {
        auth.searchParams.set(key, value)
      }
      openUrl(auth.toString()).catch(reject)
    })
    return await exchange({
      client_id: client.clientId,
      client_secret: client.clientSecret,
      code,
      code_verifier: verifier,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code'
    })
  } finally {
    server.close()
  }
}
