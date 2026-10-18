import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../integration-credential-file', () => ({
  writeEncryptedCredential: (_service: string, path: string, value: string) =>
    writeFileSync(path, `sealed:${value}`),
  readStoredCredentialToken: (_service: string, raw: Buffer) =>
    raw.toString().replace(/^sealed:/, '')
}))
vi.mock('../orca-profiles/profile-storage-paths', () => ({
  getProfileUserDataPath: () => '/unused'
}))

import { listHqSpaceKeys, readHqSpaceKey, setHqSpaceKey } from './hq-space-keys'

let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'hq-space-keys-'))
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('workspace keys', () => {
  it('saves a key per workspace and kind, lists them without reading them, and removes one', () => {
    expect(setHqSpaceKey('hobby-app', 'telegram', ' 123:abc ', root)).toEqual({ ok: true })
    expect(setHqSpaceKey('hobby-app', 'slack', 'xoxp-1', root)).toEqual({ ok: true })
    expect(setHqSpaceKey('og-news', 'clickup', 'pk_1', root)).toEqual({ ok: true })
    expect(listHqSpaceKeys(root)).toEqual({
      keys: { hobby-app: ['slack', 'telegram'], 'og-news': ['clickup'] }
    })
    expect(readHqSpaceKey('hobby-app', 'telegram', root)).toBe('123:abc')
    expect(setHqSpaceKey('hobby-app', 'telegram', null, root)).toEqual({ ok: true })
    expect(readHqSpaceKey('hobby-app', 'telegram', root)).toBeNull()
    expect(readdirSync(join(root, 'hq-space-keys')).sort()).toEqual([
      'hobby-app.slack.enc',
      'og-news.clickup.enc'
    ])
  })

  it('refuses a bad workspace name or a key with spaces', () => {
    expect(setHqSpaceKey('../etc', 'slack', 'x', root)).toEqual({
      ok: false,
      error: 'Not a workspace.'
    })
    expect(setHqSpaceKey('hobby-app', 'slack', 'two words', root)).toEqual({
      ok: false,
      error: 'A key is one line without spaces.'
    })
    expect(listHqSpaceKeys(root)).toEqual({ keys: {} })
  })
})
