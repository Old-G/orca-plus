// Custom build (worktree-sweep): Orca+'s half of the sweep after a chat close — the settings switch, the
// open tabs, and running scripts/orca-plus-worktree-sweep.mjs with Orca+'s own Electron as Node.
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import type { Store } from '../../persistence/loading-store/store'
import { getStructuredAgentSessionHost } from '../../native-chat/agent-session-wire/host/structured-agent-session-registry'
import {
  CHAT_CLOSE_SWEEP_DELAY_MS,
  countOpenTabs,
  provideChatCloseWorktreeSweep
} from './chat-close-worktree-sweep'

const SWEEP_TIMEOUT_MS = 10 * 60_000
// Why: these route the CLI to a paired server or another launcher; the sweep must ask this app (Codex P1 24.11).
const ROUTING_ENV = [
  'ORCA_ENVIRONMENT',
  'ORCA_PAIRING_CODE',
  'ORCA_REMOTE_PAIRING',
  'ORCA_CLI_COMMAND',
  'ORCA_CLI_HANDOFF'
]

function sweepScriptPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'orca-plus', 'orca-plus-worktree-sweep.mjs')
    : join(app.getAppPath(), 'scripts', 'orca-plus-worktree-sweep.mjs')
}

/** The child's environment: Electron as Node, this app's bundled `orca` and profile, no routing to elsewhere. */
function sweepEnv(): NodeJS.ProcessEnv {
  const bin = join(process.resourcesPath, 'bin')
  const profile = app.getPath('userData')
  // The macOS bundle names its CLI `orca`, the Linux one `orca-ide`.
  const cli = ['orca', 'orca-ide'].map((name) => join(bin, name)).find((path) => existsSync(path))
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
    PATH: [bin, process.env.PATH ?? '', '/usr/bin', '/bin', '/usr/sbin', '/sbin']
      .filter(Boolean)
      .join(':'),
    // Why both: the bundled launcher sets ORCA_USER_DATA_PATH from ORCA_PLUS_USER_DATA_PATH (Codex P1 24.11).
    ORCA_USER_DATA_PATH: profile,
    ORCA_PLUS_USER_DATA_PATH: profile
  }
  if (cli) {
    env.ORCA_PLUS_SWEEP_ORCA = cli
  }
  for (const name of ROUTING_ENV) {
    delete env[name]
  }
  return env
}

/** Runs the sweep with Orca+'s own Electron as Node and its bundled `orca` CLI. */
function runSweepScript(args: readonly string[]): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [sweepScriptPath(), ...args],
      { env: sweepEnv(), timeout: SWEEP_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          console.warn('[worktree-sweep] the sweep failed:', String(stderr || error.message))
          resolve(null)
          return
        }
        resolve(stdout)
      }
    )
  })
}

export function registerChatCloseWorktreeSweep(store: Store): void {
  provideChatCloseWorktreeSweep({
    // Why packaged only: a dev build's `orca` on PATH answers for the installed Orca+, not for it.
    enabled: () => app.isPackaged && store.getSettings().worktreeSweepOnChatClose !== false,
    isMainCheckout: (repoId, worktreePath) =>
      store.getRepos().some((repo) => repo.id === repoId && repo.path === worktreePath),
    openTabs: (worktreeId, closedTabIds) =>
      countOpenTabs(store.getWorkspaceSession(), worktreeId, closedTabIds),
    stillRunning: (sessionId) => getStructuredAgentSessionHost()?.hasSession(sessionId) ?? false,
    runSweep: runSweepScript,
    log: (message, detail) =>
      console.info(`[worktree-sweep] after a chat close: ${message}`, detail),
    delayMs: CHAT_CLOSE_SWEEP_DELAY_MS
  })
}
