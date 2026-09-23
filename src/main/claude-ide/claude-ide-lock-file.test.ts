import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  claudeIdeLockPath,
  removeClaudeIdeLockFile,
  removeStaleClaudeIdeLockFiles,
  resolveClaudeIdeLockDir,
  writeClaudeIdeLockFile
} from './claude-ide-lock-file'

const dirs: string[] = []
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })))

function tempLockDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'claude-ide-lock-'))
  dirs.push(dir)
  return join(dir, 'ide')
}

const lock = {
  pid: 4242,
  workspaceFolders: ['/work/repo'],
  ideName: 'Orca',
  transport: 'ws' as const,
  runningInWindows: false,
  authToken: 'token'
}

describe('claude IDE lock file', () => {
  it('honours CLAUDE_CONFIG_DIR like the CLI does', () => {
    expect(resolveClaudeIdeLockDir({ CLAUDE_CONFIG_DIR: '/cfg' })).toBe(join('/cfg', 'ide'))
    expect(resolveClaudeIdeLockDir({})).toMatch(/\.claude[\\/]ide$/)
  })

  it('writes the VS Code lock shape at <port>.lock, user-only, and removes it', () => {
    const lockDir = tempLockDir()
    writeClaudeIdeLockFile(lockDir, 38111, lock)
    const path = claudeIdeLockPath(lockDir, 38111)
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual(lock)
    if (process.platform !== 'win32') {
      expect(statSync(path).mode & 0o777).toBe(0o600)
    }
    expect(readdirSync(lockDir)).toEqual(['38111.lock'])
    removeClaudeIdeLockFile(lockDir, 38111)
    expect(readdirSync(lockDir)).toEqual([])
  })

  it('cleans only its own locks whose owner process is gone', () => {
    const lockDir = tempLockDir()
    writeClaudeIdeLockFile(lockDir, 1, { ...lock, pid: 1 })
    writeClaudeIdeLockFile(lockDir, 2, { ...lock, pid: 2 })
    writeClaudeIdeLockFile(lockDir, 3, { ...lock, pid: 3, ideName: 'Cursor' })
    writeFileSync(join(lockDir, '4.lock'), 'not json')
    removeStaleClaudeIdeLockFiles(lockDir, 'Orca', (pid) => pid === 2)
    expect(readdirSync(lockDir).sort()).toEqual(['2.lock', '3.lock', '4.lock'])
  })
})
