// Custom build (google-mcp): a Google client marked "Use this client for an AI-powered agent" may be a
// Web application client. Google sends a Web client's browser back only to an address listed on the
// client, port and path included, so Orca listens on that one port instead of a random one.
import { z } from 'zod'
import { GOOGLE_CALLBACK_PATH } from './google-sign-in-return'

/** What an admin adds to a Web client's "Authorized redirect URIs" so Orca can sign people in. */
export const GOOGLE_WEB_REDIRECT_EXAMPLE = `http://127.0.0.1:47821${GOOGLE_CALLBACK_PATH}`

const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(['127.0.0.1', 'localhost'])

/** The listed address Orca can return to: http on this computer, an explicit port, Orca's path. */
export function googleWebClientRedirect(uris: readonly string[]): string | null {
  for (const uri of uris) {
    let url: URL
    try {
      url = new URL(uri)
    } catch {
      continue
    }
    if (
      url.protocol === 'http:' &&
      LOOPBACK_HOSTS.has(url.hostname) &&
      url.port !== '' &&
      url.pathname === GOOGLE_CALLBACK_PATH &&
      !url.search &&
      !url.hash
    ) {
      return `http://${url.hostname}:${url.port}${GOOGLE_CALLBACK_PATH}`
    }
  }
  return null
}

/** The port a fixed return address listens on. */
export function googleRedirectPort(redirectUri: string): number {
  return Number(new URL(redirectUri).port)
}

const WebClient = z.object({
  client_id: z
    .string()
    .trim()
    .regex(/^[\w.-]+\.apps\.googleusercontent\.com$/, 'bad client id'),
  client_secret: z.string().trim().min(1).max(512),
  project_id: z.string().trim().min(1).max(256).optional(),
  redirect_uris: z.array(z.string().max(512)).max(100).optional()
})

export type ParsedGoogleWebClient =
  | { ok: true; clientId: string; clientSecret: string; projectId?: string; redirectUri: string }
  | { ok: false; message: string }

/** A Web app client file's `web` object, refused with what to fix when Orca can't return to it. */
export function parseGoogleWebClient(web: unknown): ParsedGoogleWebClient {
  const parsed = WebClient.safeParse(web)
  if (!parsed.success) {
    return {
      ok: false,
      message: 'This Web app client file is missing its client id or secret. Download it again.'
    }
  }
  const redirectUri = googleWebClientRedirect(parsed.data.redirect_uris ?? [])
  if (!redirectUri) {
    return {
      ok: false,
      message: `This Web app client has no address Orca can return to. In Google Cloud Console, add ${GOOGLE_WEB_REDIRECT_EXAMPLE} to its Authorized redirect URIs, then download its file again.`
    }
  }
  const { client_id: clientId, client_secret: clientSecret, project_id: projectId } = parsed.data
  return { ok: true, clientId, clientSecret, ...(projectId ? { projectId } : {}), redirectUri }
}

/** The client as Google's own Web app file, for a teammate to import. */
export function googleWebClientFile(config: {
  clientId: string
  clientSecret: string
  projectId?: string
  redirectUri: string
}): string {
  return `${JSON.stringify(
    {
      web: {
        client_id: config.clientId,
        ...(config.projectId ? { project_id: config.projectId } : {}),
        auth_uri: 'https://accounts.google.com/o/oauth2/auth',
        token_uri: 'https://oauth2.googleapis.com/token',
        client_secret: config.clientSecret,
        redirect_uris: [config.redirectUri]
      }
    },
    null,
    2
  )}\n`
}
