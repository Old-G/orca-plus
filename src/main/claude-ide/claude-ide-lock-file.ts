import {
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

// The Claude CLI discovers IDEs through `<claude config dir>/ide/<port>.lock`;
// with CLAUDE_CODE_SSE_PORT it reads that port's lock for the auth token.

export type ClaudeIdeLockFile = {
  pid: number
  workspaceFolders: string[]
  ideName: string
  transport: 'ws'
  runningInWindows: boolean
  authToken: string
}

export function resolveClaudeIdeLockDir(env: NodeJS.ProcessEnv = process.env): string {
  const configDir = env.CLAUDE_CONFIG_DIR?.trim() || join(homedir(), '.claude')
  return join(configDir, 'ide')
}

export function claudeIdeLockPath(lockDir: string, port: number): string {
  return join(lockDir, `${port}.lock`)
}

export function writeClaudeIdeLockFile(
  lockDir: string,
  port: number,
  lock: ClaudeIdeLockFile
): void {
  mkdirSync(lockDir, { recursive: true, mode: 0o700 })
  const target = claudeIdeLockPath(lockDir, port)
  const temp = `${target}.${process.pid}.tmp`
  // Why: the token grants editor access, so keep the lock user-only; rename so a
  // CLI starting mid-write never reads a torn file.
  writeFileSync(temp, JSON.stringify(lock), { mode: 0o600 })
  renameSync(temp, target)
}

export function removeClaudeIdeLockFile(lockDir: string, port: number): void {
  try {
    unlinkSync(claudeIdeLockPath(lockDir, port))
  } catch {
    // Already gone.
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    // EPERM means the pid exists under another user.
    return error instanceof Error && 'code' in error && error.code === 'EPERM'
  }
}

/** Deletes locks a crashed instance of this IDE left behind; other IDEs' locks are untouched. */
export function removeStaleClaudeIdeLockFiles(
  lockDir: string,
  ideName: string,
  isAlive: (pid: number) => boolean = isProcessAlive
): void {
  let entries: string[]
  try {
    entries = readdirSync(lockDir)
  } catch {
    return
  }
  for (const entry of entries) {
    if (!entry.endsWith('.lock')) {
      continue
    }
    const path = join(lockDir, entry)
    try {
      const lock: Partial<ClaudeIdeLockFile> = JSON.parse(readFileSync(path, 'utf8'))
      if (lock.ideName === ideName && typeof lock.pid === 'number' && !isAlive(lock.pid)) {
        unlinkSync(path)
      }
    } catch {
      // Unreadable or foreign lock: leave it for its owner.
    }
  }
}
