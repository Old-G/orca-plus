import { describe, expect, it } from 'vitest'
import { grantedGoogleChoices } from '../../shared/google/google-scopes'
import { googleClientFile, parseGoogleClientFile } from './google-client-file'

const web = (redirectUris: string[]) =>
  JSON.stringify({
    web: {
      client_id: 'web-id.apps.googleusercontent.com',
      client_secret: 'web-secret',
      project_id: 'orca-demo',
      redirect_uris: redirectUris
    }
  })

describe('a Web app client file for an AI-powered agent', () => {
  it('imports with the listed address Orca can return to, and exports as a Web app file again', () => {
    const parsed = parseGoogleClientFile(
      web(['http://localhost', 'http://127.0.0.1:47821/google/callback'])
    )
    expect(parsed).toEqual({
      ok: true,
      clientId: 'web-id.apps.googleusercontent.com',
      clientSecret: 'web-secret',
      projectId: 'orca-demo',
      redirectUri: 'http://127.0.0.1:47821/google/callback'
    })
    if (!parsed.ok) {
      return
    }
    expect(parseGoogleClientFile(googleClientFile(parsed))).toEqual(parsed)
  })

  it('is refused, naming the address to add, when no listed address has a port and Orca’s path', () => {
    const parsed = parseGoogleClientFile(web(['http://localhost', 'http://127.0.0.1:47821']))
    expect(parsed.ok).toBe(false)
    expect(!parsed.ok && parsed.message).toContain('http://127.0.0.1:47821/google/callback')
  })
})

describe('an account that allowed the broader scopes Orca asked for before', () => {
  it('keeps Gmail and Files without reconnecting', () => {
    const scope = (name: string) => `https://www.googleapis.com/auth/${name}`
    expect(
      grantedGoogleChoices([
        scope('gmail.modify'),
        scope('drive'),
        scope('documents'),
        scope('spreadsheets')
      ])
    ).toEqual(['gmail', 'files'])
  })
})
