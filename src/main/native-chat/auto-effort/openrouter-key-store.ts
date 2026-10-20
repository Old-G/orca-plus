// Custom build (chat-auto-effort): the OpenRouter key, encrypted in ~/.orca like the ClickUp token.
import { existsSync, mkdirSync, readFileSync, unlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  credentialFileHasContent,
  readStoredCredentialToken,
  writeEncryptedCredential
} from '../../integration-credential-file'

let cachedKey: string | null = null

function keyPath(): string {
  return join(homedir(), '.orca', 'openrouter-key.enc')
}

/** Never decrypts, so it is safe on every status read. */
export function hasOpenRouterKey(): boolean {
  return credentialFileHasContent(keyPath())
}

/** Null when none is saved or it cannot be decrypted. */
export function loadOpenRouterKey(): string | null {
  if (cachedKey !== null) {
    return cachedKey
  }
  const path = keyPath()
  if (!existsSync(path)) {
    return null
  }
  try {
    cachedKey = readStoredCredentialToken('OpenRouter', readFileSync(path))?.trim() || null
  } catch (error) {
    console.warn('[chat-auto-effort] the saved OpenRouter key cannot be read', error)
    return null
  }
  return cachedKey
}

export function saveOpenRouterKey(key: string): void {
  mkdirSync(join(homedir(), '.orca'), { recursive: true })
  writeEncryptedCredential('OpenRouter', keyPath(), key)
  cachedKey = key
}

export function clearOpenRouterKey(): void {
  cachedKey = null
  try {
    unlinkSync(keyPath())
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
      throw error
    }
  }
}
