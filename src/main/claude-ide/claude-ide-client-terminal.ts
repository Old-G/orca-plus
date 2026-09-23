import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { runProcess } from '../../shared/child-process/run-process'

// Which Orca terminal a connected Claude CLI runs in. Every Orca pane exports
// ORCA_TAB_ID / ORCA_PANE_KEY / ORCA_WORKTREE_ID and the CLI inherits them; the
// CLI reports its pid in `ide_connected`, so its environment names the pane.

export type ClaudeIdeClientTerminal = {
  tabId?: string
  paneKey?: string
  worktreeId?: string
}

const ENV_FIELDS: readonly (readonly [string, keyof ClaudeIdeClientTerminal])[] = [
  ['ORCA_TAB_ID=', 'tabId'],
  ['ORCA_PANE_KEY=', 'paneKey'],
  ['ORCA_WORKTREE_ID=', 'worktreeId']
]

export function parseClaudeIdeClientEnv(entries: Iterable<string>): ClaudeIdeClientTerminal | null {
  const terminal: ClaudeIdeClientTerminal = {}
  for (const entry of entries) {
    const field = ENV_FIELDS.find(([prefix]) => entry.startsWith(prefix))
    const value = field ? entry.slice(field[0].length) : ''
    if (field && value) {
      terminal[field[1]] = value
    }
  }
  return Object.keys(terminal).length > 0 ? terminal : null
}

/** `ps -E` appends `NAME=value` pairs to the command; split before each name so values keep spaces. */
export function splitPsEnvironmentLine(line: string): string[] {
  return line.trim().split(/\s(?=[A-Za-z_][A-Za-z0-9_]*=)/)
}

/**
 * A CLI started in another Orca build's terminal (stock Orca beside Orca+, or a dev build)
 * finds this IDE through `--ide` folder matching; it belongs to that build, not this one.
 */
export function isClaudeIdeClientFromOtherOrca(
  entries: readonly string[],
  ownUserDataPath: string
): boolean {
  const prefix = 'ORCA_USER_DATA_PATH='
  const entry = entries.find((candidate) => candidate.startsWith(prefix))
  const clientPath = entry?.slice(prefix.length)
  return clientPath ? resolve(clientPath) !== resolve(ownUserDataPath) : false
}

export async function readClaudeIdeClientEnvironment(
  pid: number,
  platform: NodeJS.Platform = process.platform
): Promise<string[] | null> {
  try {
    if (platform === 'linux') {
      return (await readFile(`/proc/${pid}/environ`, 'utf8')).split('\0')
    }
    if (platform === 'darwin') {
      const result = await runProcess({
        program: '/bin/ps',
        args: ['-wwE', '-p', String(pid), '-o', 'command='],
        timeoutMs: 2000
      })
      return result.code === 0 ? splitPsEnvironmentLine(result.stdout) : null
    }
  } catch {
    // The CLI exited or the process is not readable: treat it as an unknown pane.
  }
  // Windows has no cheap way to read another process's environment.
  return null
}

export async function readClaudeIdeClientTerminal(
  pid: number,
  platform: NodeJS.Platform = process.platform
): Promise<ClaudeIdeClientTerminal | null> {
  const entries = await readClaudeIdeClientEnvironment(pid, platform)
  return entries ? parseClaudeIdeClientEnv(entries) : null
}
