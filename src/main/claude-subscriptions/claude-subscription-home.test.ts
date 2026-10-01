import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  describeUnusableClaudeSubscriptionDir,
  prepareClaudeSubscriptionHome
} from './claude-subscription-home'

let root = ''
let systemHome = ''
let subscriptionDir = ''

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'orca-claude-subscription-'))
  systemHome = join(root, '.claude')
  subscriptionDir = join(root, '.claude-lh')
  mkdirSync(join(systemHome, 'projects', '-repo'), { recursive: true })
  mkdirSync(join(systemHome, 'skills'), { recursive: true })
  writeFileSync(join(systemHome, 'settings.json'), '{"hooks":{}}')
  writeFileSync(join(systemHome, 'CLAUDE.md'), '@RTK.md')
  writeFileSync(join(systemHome, 'RTK.md'), 'rtk')
  writeFileSync(join(systemHome, '.claude.json'), '{"oauthAccount":{"emailAddress":"base"}}')
  writeFileSync(join(systemHome, '.credentials.json'), '{}')
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

function linkTarget(entry: string): string | null {
  const path = join(subscriptionDir, entry)
  return lstatSync(path).isSymbolicLink() ? readlinkSync(path) : null
}

describe('prepareClaudeSubscriptionHome', () => {
  it('links shared entries and every top-level markdown file into ~/.claude', () => {
    prepareClaudeSubscriptionHome(subscriptionDir, { systemHomePath: systemHome, home: root })

    expect(linkTarget('settings.json')).toBe(join(systemHome, 'settings.json'))
    expect(linkTarget('projects')).toBe(join(systemHome, 'projects'))
    expect(linkTarget('skills')).toBe(join(systemHome, 'skills'))
    expect(linkTarget('CLAUDE.md')).toBe(join(systemHome, 'CLAUDE.md'))
    expect(linkTarget('RTK.md')).toBe(join(systemHome, 'RTK.md'))
  })

  it('never shares sign-in or account state', () => {
    prepareClaudeSubscriptionHome(subscriptionDir, { systemHomePath: systemHome, home: root })

    expect(existsSync(join(subscriptionDir, '.claude.json'))).toBe(false)
    expect(existsSync(join(subscriptionDir, '.credentials.json'))).toBe(false)
  })

  it('moves a file the CLI created first into backups instead of deleting it', () => {
    mkdirSync(subscriptionDir, { recursive: true })
    writeFileSync(join(subscriptionDir, 'settings.json'), '{"theme":"dark"}')
    writeFileSync(join(subscriptionDir, '.claude.json'), '{"oauthAccount":{"emailAddress":"lh"}}')

    const moved = prepareClaudeSubscriptionHome(subscriptionDir, {
      systemHomePath: systemHome,
      home: root,
      now: () => new Date('2026-10-01T09:00:00.000Z')
    })

    expect(moved).toEqual(['settings.json'])
    expect(linkTarget('settings.json')).toBe(join(systemHome, 'settings.json'))
    const backup = join(subscriptionDir, 'backups', 'orca-shared-2026-10-01T09-00-00-000Z')
    expect(readFileSync(join(backup, 'settings.json'), 'utf-8')).toBe('{"theme":"dark"}')
    expect(readFileSync(join(subscriptionDir, '.claude.json'), 'utf-8')).toContain('lh')
  })

  it('is a no-op on a prepared dir', () => {
    prepareClaudeSubscriptionHome(subscriptionDir, { systemHomePath: systemHome, home: root })
    const moved = prepareClaudeSubscriptionHome(subscriptionDir, {
      systemHomePath: systemHome,
      home: root
    })

    expect(moved).toEqual([])
    expect(existsSync(join(subscriptionDir, 'backups'))).toBe(false)
  })

  it('refuses ~/.claude under any alias, the home folder, and foreign folders', () => {
    const opts = { systemHomePath: systemHome, home: root }
    symlinkSync(systemHome, join(root, 'claude-alias'))
    mkdirSync(join(root, 'project'))
    writeFileSync(join(root, 'project', 'CLAUDE.md'), 'mine')
    for (const dir of [
      systemHome,
      join(root, '.CLAUDE'),
      join(root, 'claude-alias'),
      join(systemHome, 'nested'),
      root,
      join(root, 'project'),
      '.claude-lh'
    ]) {
      expect(describeUnusableClaudeSubscriptionDir(dir, opts), dir).not.toBeNull()
      expect(() => prepareClaudeSubscriptionHome(dir, opts), dir).toThrow()
    }
    // Nothing of the base or the project was moved aside.
    expect(readdirSync(systemHome).sort()).toEqual([
      '.claude.json',
      '.credentials.json',
      'CLAUDE.md',
      'RTK.md',
      'projects',
      'settings.json',
      'skills'
    ])
    expect(readFileSync(join(root, 'project', 'CLAUDE.md'), 'utf-8')).toBe('mine')
  })

  it('accepts a new folder or a Claude config folder', () => {
    const opts = { systemHomePath: systemHome, home: root }
    expect(describeUnusableClaudeSubscriptionDir(join(root, '.claude-new'), opts)).toBeNull()
    mkdirSync(join(root, '.claude-cli'))
    writeFileSync(join(root, '.claude-cli', '.claude.json'), '{}')
    expect(describeUnusableClaudeSubscriptionDir(join(root, '.claude-cli'), opts)).toBeNull()
  })

  it('creates shared dirs in the base first, so none starts private and is moved aside later', () => {
    prepareClaudeSubscriptionHome(subscriptionDir, { systemHomePath: systemHome, home: root })

    expect(existsSync(join(systemHome, 'plans'))).toBe(true)
    expect(linkTarget('plans')).toBe(join(systemHome, 'plans'))
  })
})
