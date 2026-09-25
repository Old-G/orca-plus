import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  CredentialDecryptionError,
  readStoredCredentialToken,
  writeCredentialFileAtomic,
  writeEncryptedCredential
} from '../credentials/integration-credential-file'
import {
  credentialFileHasContentSync,
  removeCredentialFilesInOrder
} from '../credentials/custom-credential-file-sync'
import { getProfileUserDataPath } from '../orca-profiles/profile-storage-paths'
import type { SlackPerson, SlackTarget } from '../../shared/slack-types'
import { asSlackRecord } from './slack-request'

export type SlackTokens = { botToken: string; appToken: string }

export type SlackStoredMetadata = {
  version: 1
  teamId: string
  teamName: string
  bot: SlackPerson
  owner: SlackPerson
  /** The bot's DM channel with the owner (D…), needed to thread replies there. */
  dmChannelId: string
  target: SlackTarget
  updatedAt: string
}

let cachedMetadata: SlackStoredMetadata | null = null
let metadataLoadedFromDisk = false
let cachedTokens: SlackTokens | null = null
let credentialError: string | null = null

// Why per profile, not ~/.orca like ClickUp: Socket Mode hands each event to ONE of the app's
// open connections, so a dev build and the installed app sharing tokens would steal replies.
function getSlackDir(): string {
  return join(getProfileUserDataPath(), 'slack')
}

function getMetadataPath(): string {
  return join(getSlackDir(), 'credential.json')
}

function getSecretPath(): string {
  return join(getSlackDir(), 'credential.enc')
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

function readPerson(value: unknown): SlackPerson | null {
  const raw = asSlackRecord(value)
  const id = asString(raw.id)
  return id ? { id, name: asString(raw.name) ?? id } : null
}

function readTarget(value: unknown): SlackTarget {
  const raw = asSlackRecord(value)
  const channelId = asString(raw.channelId)
  return raw.kind === 'channel' && channelId
    ? { kind: 'channel', channelId, channelName: asString(raw.channelName) ?? channelId }
    : { kind: 'dm' }
}

function readMetadataFromDisk(): SlackStoredMetadata | null {
  const path = getMetadataPath()
  if (!existsSync(path)) {
    return null
  }
  try {
    const raw = asSlackRecord(JSON.parse(readFileSync(path, 'utf-8')))
    const teamId = asString(raw.teamId)
    const bot = readPerson(raw.bot)
    const owner = readPerson(raw.owner)
    const dmChannelId = asString(raw.dmChannelId)
    if (!teamId || !bot || !owner || !dmChannelId) {
      return null
    }
    return {
      version: 1,
      teamId,
      teamName: asString(raw.teamName) ?? teamId,
      bot,
      owner,
      dmChannelId,
      target: readTarget(raw.target),
      updatedAt: asString(raw.updatedAt) ?? ''
    }
  } catch {
    return null
  }
}

export function getStoredSlackMetadata(): SlackStoredMetadata | null {
  if (!metadataLoadedFromDisk) {
    cachedMetadata = readMetadataFromDisk()
    metadataLoadedFromDisk = true
  }
  return cachedMetadata
}

/** Never decrypts, so it is safe on every status poll. */
export function hasStoredSlackCredential(): boolean {
  return getStoredSlackMetadata() !== null && credentialFileHasContentSync(getSecretPath())
}

export function getSlackCredentialError(): string | null {
  return credentialError
}

export function setSlackCredentialError(message: string | null): void {
  credentialError = message
}

function parseTokens(serialized: string | null): SlackTokens | null {
  if (!serialized) {
    return null
  }
  try {
    const raw = asSlackRecord(JSON.parse(serialized))
    const botToken = asString(raw.botToken)
    const appToken = asString(raw.appToken)
    return botToken && appToken ? { botToken, appToken } : null
  } catch {
    return null
  }
}

/** Throws CredentialDecryptionError when the ciphertext cannot be decrypted. */
export function loadStoredSlackTokens(): SlackTokens | null {
  if (cachedTokens !== null) {
    return cachedTokens
  }
  const path = getSecretPath()
  if (!existsSync(path)) {
    return null
  }
  try {
    cachedTokens = parseTokens(readStoredCredentialToken('Slack', readFileSync(path)))
    return cachedTokens
  } catch (error) {
    if (error instanceof CredentialDecryptionError) {
      credentialError = error.message
    }
    throw error
  }
}

export async function saveSlackCredential(
  tokens: SlackTokens,
  metadata: SlackStoredMetadata
): Promise<void> {
  const dir = getSlackDir()
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  await writeEncryptedCredential('Slack', getSecretPath(), JSON.stringify(tokens))
  await writeSlackMetadata(metadata)
  cachedTokens = tokens
  credentialError = null
}

export async function writeSlackMetadata(metadata: SlackStoredMetadata): Promise<void> {
  cachedMetadata = metadata
  metadataLoadedFromDisk = true
  await writeCredentialFileAtomic(
    getMetadataPath(),
    Buffer.from(JSON.stringify(metadata, null, 2), 'utf-8')
  )
}

export async function clearStoredSlackCredential(): Promise<void> {
  try {
    await removeCredentialFilesInOrder([getSecretPath(), getMetadataPath()])
  } finally {
    // Why: a partial delete must still drop the caches, or the session keeps using revoked tokens.
    cachedMetadata = null
    metadataLoadedFromDisk = true
    cachedTokens = null
    credentialError = null
  }
}

/** @internal - tests need a clean in-memory cache between cases. */
export function _resetSlackCredentialCache(): void {
  cachedMetadata = null
  metadataLoadedFromDisk = false
  cachedTokens = null
  credentialError = null
}
