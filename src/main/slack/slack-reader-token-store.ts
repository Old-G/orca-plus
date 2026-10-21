// Custom build (slack-reply-reader): the owner's own Slack user token (xoxp-), kept apart from the
// bot's tokens. With it Orca+ reads the DMs and threads where a chat waits for someone's answer —
// conversations a bot is never part of.
import { existsSync, mkdirSync, readFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import {
  credentialFileHasContent,
  readStoredCredentialToken,
  writeCredentialFileAtomic,
  writeEncryptedCredential
} from '../integration-credential-file'
import { getProfileUserDataPath } from '../orca-profiles/profile-storage-paths'
import type { SlackPerson } from '../../shared/slack-types'
import { asSlackRecord } from './slack-request'

export type SlackReaderMetadata = {
  teamId: string
  teamName: string
  /** Whose token it is; their own messages are never answers. */
  user: SlackPerson
  updatedAt: string
}

let cachedToken: string | null = null
let cachedMetadata: SlackReaderMetadata | null | undefined

function readerDir(): string {
  return join(getProfileUserDataPath(), 'slack')
}

function secretPath(): string {
  return join(readerDir(), 'reader.enc')
}

function metadataPath(): string {
  return join(readerDir(), 'reader.json')
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

export function getSlackReaderMetadata(): SlackReaderMetadata | null {
  if (cachedMetadata !== undefined) {
    return cachedMetadata
  }
  cachedMetadata = null
  if (existsSync(metadataPath())) {
    try {
      const raw = asSlackRecord(JSON.parse(readFileSync(metadataPath(), 'utf-8')))
      const user = asSlackRecord(raw.user)
      const teamId = asString(raw.teamId)
      const userId = asString(user.id)
      if (teamId && userId) {
        cachedMetadata = {
          teamId,
          teamName: asString(raw.teamName) ?? teamId,
          user: { id: userId, name: asString(user.name) ?? userId },
          updatedAt: asString(raw.updatedAt) ?? ''
        }
      }
    } catch {
      cachedMetadata = null
    }
  }
  return cachedMetadata
}

/** Never decrypts, so it is safe on every status poll. */
export function hasSlackReaderToken(): boolean {
  return getSlackReaderMetadata() !== null && credentialFileHasContent(secretPath())
}

/** Throws CredentialDecryptionError when the ciphertext cannot be decrypted. */
export function loadSlackReaderToken(): string | null {
  if (cachedToken !== null) {
    return cachedToken
  }
  if (!existsSync(secretPath())) {
    return null
  }
  cachedToken = asString(readStoredCredentialToken('Slack', readFileSync(secretPath())))
  return cachedToken
}

export function saveSlackReaderToken(token: string, metadata: SlackReaderMetadata): void {
  if (!existsSync(readerDir())) {
    mkdirSync(readerDir(), { recursive: true })
  }
  writeEncryptedCredential('Slack', secretPath(), token)
  writeCredentialFileAtomic(metadataPath(), Buffer.from(JSON.stringify(metadata, null, 2), 'utf-8'))
  cachedToken = token
  cachedMetadata = metadata
}

export function clearSlackReaderToken(): void {
  try {
    for (const path of [secretPath(), metadataPath()]) {
      if (existsSync(path)) {
        unlinkSync(path)
      }
    }
  } finally {
    cachedToken = null
    cachedMetadata = null
  }
}

/** @internal - tests need a clean in-memory cache between cases. */
export function _resetSlackReaderTokenCache(): void {
  cachedToken = null
  cachedMetadata = undefined
}
