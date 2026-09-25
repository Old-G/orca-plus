import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  credentialFileHasContentSync,
  removeCredentialFilesInOrder
} from '../credentials/custom-credential-file-sync'
import {
  CredentialDecryptionError,
  readStoredCredentialToken,
  writeCredentialFileAtomic,
  writeEncryptedCredential
} from '../credentials/integration-credential-file'
import type { ClickUpViewer, ClickUpWorkspace } from '../../shared/clickup-types'
import { asClickUpRecord } from './clickup-task-mapping'

// Why: the token stays encrypted via safeStorage while this metadata stays
// plaintext, so status reads render the account without a keychain prompt.
export type ClickUpStoredMetadata = {
  version: 1
  viewer: ClickUpViewer
  workspaces: ClickUpWorkspace[]
  selectedWorkspaceId: string | null
  updatedAt: string
}

let cachedMetadata: ClickUpStoredMetadata | null = null
let metadataLoadedFromDisk = false
let cachedToken: string | null = null
let credentialError: string | null = null

function getOrcaDir(): string {
  return join(homedir(), '.orca')
}

function getMetadataPath(): string {
  return join(getOrcaDir(), 'clickup-credential.json')
}

function getSecretPath(): string {
  return join(getOrcaDir(), 'clickup-credential.enc')
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

function parseWorkspaces(value: unknown): ClickUpWorkspace[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value.flatMap((entry) => {
    const raw = asClickUpRecord(entry)
    const id = asString(raw.id)
    return id ? [{ id, name: asString(raw.name) ?? id }] : []
  })
}

function readMetadataFromDisk(): ClickUpStoredMetadata | null {
  const path = getMetadataPath()
  if (!existsSync(path)) {
    return null
  }
  try {
    const raw = asClickUpRecord(JSON.parse(readFileSync(path, 'utf-8')))
    const viewerRaw = asClickUpRecord(raw.viewer)
    const viewerId = asString(viewerRaw.id)
    if (!viewerId) {
      return null
    }
    const workspaces = parseWorkspaces(raw.workspaces)
    const selected = asString(raw.selectedWorkspaceId)
    return {
      version: 1,
      viewer: {
        id: viewerId,
        username: asString(viewerRaw.username) ?? viewerId,
        email: asString(viewerRaw.email)
      },
      workspaces,
      selectedWorkspaceId:
        selected && workspaces.some((workspace) => workspace.id === selected)
          ? selected
          : (workspaces[0]?.id ?? null),
      updatedAt: asString(raw.updatedAt) ?? ''
    }
  } catch {
    return null
  }
}

export function getStoredClickUpMetadata(): ClickUpStoredMetadata | null {
  if (!metadataLoadedFromDisk) {
    cachedMetadata = readMetadataFromDisk()
    metadataLoadedFromDisk = true
  }
  return cachedMetadata
}

/** Never decrypts, so it is safe on every status poll. */
export function hasStoredClickUpCredential(): boolean {
  return getStoredClickUpMetadata() !== null && credentialFileHasContentSync(getSecretPath())
}

export function getClickUpCredentialError(): string | null {
  return credentialError
}

export function setClickUpCredentialError(message: string | null): void {
  credentialError = message
}

/** Throws CredentialDecryptionError when the ciphertext cannot be decrypted. */
export function loadStoredClickUpToken(): string | null {
  if (cachedToken !== null) {
    return cachedToken
  }
  const path = getSecretPath()
  if (!existsSync(path)) {
    return null
  }
  try {
    const token = readStoredCredentialToken('ClickUp', readFileSync(path))
    cachedToken = token?.trim() || null
    return cachedToken
  } catch (error) {
    if (error instanceof CredentialDecryptionError) {
      credentialError = error.message
    }
    throw error
  }
}

export async function saveClickUpCredential(input: {
  token: string
  viewer: ClickUpViewer
  workspaces: ClickUpWorkspace[]
  selectedWorkspaceId: string | null
}): Promise<void> {
  const dir = getOrcaDir()
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  // Why: upstream's credential writes are async and ordered per file (#44661); wait for both so a
  // connect reports success only once the token is on disk.
  await writeEncryptedCredential('ClickUp', getSecretPath(), input.token)
  await writeClickUpMetadata({
    version: 1,
    viewer: input.viewer,
    workspaces: input.workspaces,
    selectedWorkspaceId: input.selectedWorkspaceId,
    updatedAt: new Date().toISOString()
  })
  cachedToken = input.token
  credentialError = null
}

export async function writeClickUpMetadata(metadata: ClickUpStoredMetadata): Promise<void> {
  cachedMetadata = metadata
  metadataLoadedFromDisk = true
  await writeCredentialFileAtomic(
    getMetadataPath(),
    Buffer.from(JSON.stringify(metadata, null, 2), 'utf-8')
  )
}

export async function clearStoredClickUpCredential(): Promise<void> {
  try {
    await removeCredentialFilesInOrder([getSecretPath(), getMetadataPath()])
  } finally {
    // Why: a partial delete must still drop the caches, or the session keeps
    // authenticating with a token the user just disconnected.
    cachedMetadata = null
    metadataLoadedFromDisk = true
    cachedToken = null
    credentialError = null
  }
}

/** @internal - tests need a clean in-memory cache between cases. */
export function _resetClickUpCredentialCache(): void {
  cachedMetadata = null
  metadataLoadedFromDisk = false
  cachedToken = null
  credentialError = null
}
