import { lstatSync, mkdirSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { linkSystemResourcesIntoHome, targetAlreadyPointsToSource } from '../codex/codex-home-paths'

// Everything a session reads or Orca writes through `~/.claude` — hooks and statusline in
// settings.json, transcripts under projects/, IDE locks, skills, plugins. Sign-in and account
// state (`.claude.json`, keychain, policy/remote settings, caches) stay per directory.
const CLAUDE_SHARED_DIRECTORIES = [
  'agents',
  'commands',
  'skills',
  'plugins',
  'output-styles',
  'hooks',
  'projects',
  'transcripts',
  'ide',
  'todos',
  'plans',
  'file-history',
  'shell-snapshots',
  'session-env',
  'tasks',
  'teams'
] as const

const CLAUDE_SHARED_FILES = [
  'settings.json',
  'settings.local.json',
  'history.jsonl',
  'statusline-command.sh'
] as const

/** Written into a dir Orca prepared, so later launches know its contents are Orca's to arrange. */
const MANAGED_MARKER = '.orca-claude-subscription'

export class UnsafeClaudeSubscriptionDirError extends Error {
  constructor(configDir: string, reason: string) {
    super(`Not usable as a Claude subscription folder (${reason}): ${configDir}`)
    this.name = 'UnsafeClaudeSubscriptionDirError'
  }
}

export function getSystemClaudeHomePath(): string {
  return join(homedir(), '.claude')
}

function fileId(path: string): string | null {
  try {
    const stat = statSync(path)
    return `${stat.dev}:${stat.ino}`
  } catch {
    return null
  }
}

function exists(path: string): boolean {
  try {
    lstatSync(path)
    return true
  } catch {
    return false
  }
}

function sameLexicalPath(a: string, b: string): boolean {
  return resolve(a).toLowerCase() === resolve(b).toLowerCase()
}

/**
 * Why a dir cannot hold a subscription, or null. Compared by inode as well as by lowercased path,
 * so a case variant (`~/.Claude`) or a symlink alias of `~/.claude` or `~` is caught: preparing
 * either would move the real `~/.claude` contents aside.
 */
export function describeUnsafeClaudeSubscriptionDir(
  configDir: string,
  options: { systemHomePath?: string; home?: string } = {}
): string | null {
  const home = options.home ?? homedir()
  const systemHomePath = options.systemHomePath ?? join(home, '.claude')
  if (!isAbsolute(configDir)) {
    return 'not an absolute path'
  }
  const candidate = resolve(configDir)
  const claudeId = fileId(systemHomePath)
  const homeAndAncestorIds = new Set<string>()
  for (let path = resolve(home); ; path = dirname(path)) {
    const id = fileId(path)
    if (id) {
      homeAndAncestorIds.add(id)
    }
    if (sameLexicalPath(path, candidate)) {
      return 'the home folder or one of its parents'
    }
    if (dirname(path) === path) {
      break
    }
  }
  const candidateId = fileId(candidate)
  if (candidateId && homeAndAncestorIds.has(candidateId)) {
    return 'the home folder or one of its parents'
  }
  for (let path = candidate; ; path = dirname(path)) {
    const id = fileId(path)
    if (sameLexicalPath(path, systemHomePath) || (id !== null && id === claudeId)) {
      return '~/.claude or a folder inside it'
    }
    if (dirname(path) === path) {
      break
    }
  }
  return null
}

/** Orca may rearrange a dir it prepared, an empty one, or a Claude config dir (`.claude.json`). */
function isClaudeOwnedDir(configDir: string): boolean {
  try {
    const entries = readdirSync(configDir)
    return (
      entries.length === 0 || entries.includes(MANAGED_MARKER) || entries.includes('.claude.json')
    )
  } catch {
    // Absent: created fresh on prepare.
    return true
  }
}

/** Settings-time check: a subscription may name a new folder or a Claude config folder only. */
export function describeUnusableClaudeSubscriptionDir(
  configDir: string,
  options: { systemHomePath?: string; home?: string } = {}
): string | null {
  return (
    describeUnsafeClaudeSubscriptionDir(configDir, options) ??
    (isClaudeOwnedDir(configDir) ? null : 'a folder with other contents')
  )
}

/** The listed shared entries plus top-level markdown (CLAUDE.md and the files it `@`-imports). */
function listSharedEntries(systemHomePath: string): string[] {
  let markdown: string[] = []
  try {
    markdown = readdirSync(systemHomePath).filter((name) => name.endsWith('.md'))
  } catch {
    // An unreadable ~/.claude shares nothing extra; absent sources are skipped by the linker.
  }
  return [...CLAUDE_SHARED_DIRECTORIES, ...CLAUDE_SHARED_FILES, ...markdown]
}

/**
 * Makes a subscription's config dir complete: shared entries become links into `~/.claude`.
 * A file the CLI created there before Orca managed the dir (e.g. its first settings.json) is
 * moved to `backups/orca-shared-<time>/`, never deleted. Returns the entries moved aside.
 */
export function prepareClaudeSubscriptionHome(
  configDir: string,
  options: { systemHomePath?: string; home?: string; now?: () => Date } = {}
): string[] {
  const systemHomePath = options.systemHomePath ?? getSystemClaudeHomePath()
  const unusable = describeUnusableClaudeSubscriptionDir(configDir, {
    systemHomePath,
    ...(options.home ? { home: options.home } : {})
  })
  if (unusable) {
    throw new UnsafeClaudeSubscriptionDirError(configDir, unusable)
  }
  mkdirSync(configDir, { recursive: true, mode: 0o700 })
  // A shared dir the base lacks today would otherwise start as a private folder here and be moved
  // aside, mid-session, once the base creates it.
  for (const name of CLAUDE_SHARED_DIRECTORIES) {
    mkdirSync(join(systemHomePath, name), { recursive: true })
  }
  const entries = listSharedEntries(systemHomePath)
  const movedAside: string[] = []
  let backupDir: string | null = null
  for (const entryName of entries) {
    const sourcePath = join(systemHomePath, entryName)
    const targetPath = join(configDir, entryName)
    if (
      !exists(sourcePath) ||
      !exists(targetPath) ||
      targetAlreadyPointsToSource(targetPath, sourcePath)
    ) {
      continue
    }
    if (!backupDir) {
      const stamp = (options.now?.() ?? new Date()).toISOString().replace(/[:.]/g, '-')
      backupDir = join(configDir, 'backups', `orca-shared-${stamp}`)
      mkdirSync(backupDir, { recursive: true, mode: 0o700 })
    }
    renameSync(targetPath, join(backupDir, entryName))
    movedAside.push(entryName)
  }
  if (movedAside.length > 0) {
    console.warn('[claude-subscriptions] Moved aside before linking:', configDir, movedAside)
  }
  linkSystemResourcesIntoHome(systemHomePath, configDir, entries)
  writeFileSync(join(configDir, MANAGED_MARKER), '', { mode: 0o600 })
  return movedAside
}
