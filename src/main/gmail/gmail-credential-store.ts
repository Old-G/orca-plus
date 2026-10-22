// Custom build (hq-mail-intake): the owner's Google OAuth client (from the Cloud Console's JSON) and
// the refresh token Orca+ reads Gmail with, both encrypted in the profile.
import { existsSync, mkdirSync, readFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import {
  readStoredCredentialToken,
  writeCredentialFileAtomic,
  writeEncryptedCredential
} from '../integration-credential-file'
import { getProfileUserDataPath } from '../orca-profiles/profile-storage-paths'

export type GmailClient = { clientId: string; clientSecret: string }

let cachedToken: string | null = null

function gmailDir(): string {
  return join(getProfileUserDataPath(), 'gmail')
}

const clientPath = (): string => join(gmailDir(), 'client.enc')
const tokenPath = (): string => join(gmailDir(), 'token.enc')
// Why: the address alone, readable without the keychain, so every status poll stays cheap.
const accountPath = (): string => join(gmailDir(), 'account.json')

function ensureDir(): void {
  if (!existsSync(gmailDir())) {
    mkdirSync(gmailDir(), { recursive: true })
  }
}

/** `{"installed": {"client_id", "client_secret"}}`, as the Console downloads a Desktop app client. */
export function parseGmailClientFile(text: string): GmailClient | null {
  try {
    const raw: unknown = JSON.parse(text)
    const section =
      raw && typeof raw === 'object'
        ? (Reflect.get(raw, 'installed') ?? Reflect.get(raw, 'web'))
        : null
    if (!section || typeof section !== 'object') {
      return null
    }
    const clientId: unknown = Reflect.get(section, 'client_id')
    const clientSecret: unknown = Reflect.get(section, 'client_secret')
    return typeof clientId === 'string' && clientId && typeof clientSecret === 'string'
      ? { clientId, clientSecret }
      : null
  } catch {
    return null
  }
}

export function loadGmailClient(): GmailClient | null {
  if (!existsSync(clientPath())) {
    return null
  }
  const text = readStoredCredentialToken('Gmail', readFileSync(clientPath()))
  try {
    const raw: unknown = text ? JSON.parse(text) : null
    const clientId: unknown = raw && typeof raw === 'object' ? Reflect.get(raw, 'clientId') : null
    const clientSecret: unknown =
      raw && typeof raw === 'object' ? Reflect.get(raw, 'clientSecret') : null
    return typeof clientId === 'string' && typeof clientSecret === 'string'
      ? { clientId, clientSecret }
      : null
  } catch {
    return null
  }
}

export function hasGmailClient(): boolean {
  return existsSync(clientPath())
}

export function saveGmailClient(client: GmailClient): void {
  ensureDir()
  writeEncryptedCredential('Gmail', clientPath(), JSON.stringify(client))
}

export function gmailAccount(): string | null {
  try {
    const raw: unknown = JSON.parse(readFileSync(accountPath(), 'utf-8'))
    const email: unknown = raw && typeof raw === 'object' ? Reflect.get(raw, 'email') : null
    return typeof email === 'string' && email && existsSync(tokenPath()) ? email : null
  } catch {
    return null
  }
}

/** Throws CredentialDecryptionError when the keychain refuses. */
export function loadGmailRefreshToken(): string | null {
  if (cachedToken === null && existsSync(tokenPath())) {
    cachedToken = readStoredCredentialToken('Gmail', readFileSync(tokenPath()))
  }
  return cachedToken
}

export function saveGmailRefreshToken(refreshToken: string, email: string): void {
  ensureDir()
  writeEncryptedCredential('Gmail', tokenPath(), refreshToken)
  writeCredentialFileAtomic(
    accountPath(),
    Buffer.from(JSON.stringify({ email, updatedAt: new Date().toISOString() }, null, 2), 'utf-8')
  )
  cachedToken = refreshToken
}

/** Forgets the sign-in; the client stays, so connecting again is one click. */
export function clearGmailRefreshToken(): void {
  try {
    for (const path of [tokenPath(), accountPath()]) {
      if (existsSync(path)) {
        unlinkSync(path)
      }
    }
  } finally {
    cachedToken = null
  }
}
