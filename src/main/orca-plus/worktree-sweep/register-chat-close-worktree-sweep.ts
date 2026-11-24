// Custom build (worktree-sweep): Orca+'s half of the sweep after a chat close — the settings switch, the
// open tabs, and running scripts/orca-plus-worktree-sweep.mjs with Orca+'s own Electron as Node.
import { execFile } from 'node:child_process'
import { join } from 'node:path'
import { app } from 'electron'
import type { Store } from '../../persistence/loading-store/store'
import { getStructuredAgentSessionHost } from '../../native-chat/agent-session-wire/host/structured-agent-session-registry'
import {
  CHAT_CLOSE_SWEEP_DELAY_MS,
  provideChatCloseWorktreeSweep
} from './chat-close-worktree-sweep'

const SWEEP_TIMEOUT_MS = 10 * 60_000
const NATIVE_CHAT_TAB = 'structured-agent-session-'

function sweepScriptPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'orca-plus', 'orca-plus-worktree-sweep.mjs')
    : join(app.getAppPath(), 'scripts', 'orca-plus-worktree-sweep.mjs')
}

/** Runs the sweep with Orca+'s own Electron as Node and its bundled `orca` CLI first on PATH. */
function runSweepScript(args: readonly string[]): Promise<string | null> {
  const path = [
    join(process.resourcesPath, 'bin'),
    process.env.PATH ?? '',
    '/usr/bin',
    '/bin',
    '/usr/sbin',
    '/sbin'
  ]
    .filter(Boolean)
    .join(':')
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [sweepScriptPath(), ...args],
      {
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', PATH: path },
        timeout: SWEEP_TIMEOUT_MS,
        maxBuffer: 64 * 1024 * 1024
      },
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
    openTabs: (worktreeId, closedSessionId) =>
      (store.getWorkspaceSession().unifiedTabs?.[worktreeId] ?? []).filter(
        (tab) =>
          tab.id !== `${NATIVE_CHAT_TAB}${closedSessionId}` &&
          !tab.id.startsWith(`${NATIVE_CHAT_TAB}${closedSessionId}:`)
      ).length,
    stillRunning: (sessionId) => getStructuredAgentSessionHost()?.hasSession(sessionId) ?? false,
    runSweep: runSweepScript,
    log: (message, detail) =>
      console.info(`[worktree-sweep] after a chat close: ${message}`, detail),
    delayMs: CHAT_CLOSE_SWEEP_DELAY_MS
  })
}
