// Custom build (hq-space-keys): each workspace's own tokens — a second Slack, a Telegram bot, another
// ClickUp — one encrypted file per workspace and kind, kept apart from Orca's own connections. Listing
// reads file names only, so it never asks the keychain.
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { readStoredCredentialToken, writeEncryptedCredential } from '../integration-credential-file'
import { getProfileUserDataPath } from '../orca-profiles/profile-storage-paths'
import {
  HQ_SPACE_KEY_KINDS,
  HQ_SPACE_SLUG,
  type HqSpaceKeyKind,
  type HqSpaceKeysResult
} from '../../shared/hq-spaces'

const KEY_MAX = 4000

function keysDir(root: string): string {
  return join(root, 'hq-space-keys')
}

function keyPath(root: string, space: string, kind: HqSpaceKeyKind): string {
  return join(keysDir(root), `${space}.${kind}.enc`)
}

export function listHqSpaceKeys(root = getProfileUserDataPath()): HqSpaceKeysResult {
  const keys: Record<string, HqSpaceKeyKind[]> = {}
  const names = existsSync(keysDir(root)) ? readdirSync(keysDir(root)) : []
  for (const name of names) {
    const match = /^([a-z0-9][a-z0-9-]{0,62})\.([a-z]+)\.enc$/.exec(name)
    const kind = HQ_SPACE_KEY_KINDS.find((entry) => entry === match?.[2])
    if (match && kind) {
      keys[match[1]] = [...(keys[match[1]] ?? []), kind].sort()
    }
  }
  return { keys }
}

/** Saves the token, or removes it with null. */
export function setHqSpaceKey(
  space: string,
  kind: HqSpaceKeyKind,
  value: string | null,
  root = getProfileUserDataPath()
): { ok: true } | { ok: false; error: string } {
  if (!HQ_SPACE_SLUG.test(space)) {
    return { ok: false, error: 'Not a workspace.' }
  }
  const path = keyPath(root, space, kind)
  const token = value?.trim() ?? ''
  if (!token) {
    if (existsSync(path)) {
      unlinkSync(path)
    }
    return { ok: true }
  }
  if (token.length > KEY_MAX || /\s/.test(token)) {
    return { ok: false, error: 'A key is one line without spaces.' }
  }
  mkdirSync(keysDir(root), { recursive: true })
  writeEncryptedCredential('Workspace', path, token)
  return { ok: true }
}

/** The workspace's own token for an adapter in main; null when it has none. */
export function readHqSpaceKey(
  space: string,
  kind: HqSpaceKeyKind,
  root = getProfileUserDataPath()
): string | null {
  const path = keyPath(root, space, kind)
  return HQ_SPACE_SLUG.test(space) && existsSync(path)
    ? readStoredCredentialToken('Workspace', readFileSync(path))
    : null
}
