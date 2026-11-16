// Custom build (claude-background-pause): sets up the background gate at startup — its reading, the
// state file the launchd jobs read, a refresh that keeps both current while no window is watched,
// the HQ banner's IPC, and the one catch-up run of launchd jobs held back in the pause.
import { app, BrowserWindow, ipcMain } from 'electron'
import { execFile } from 'node:child_process'
import { join } from 'node:path'
import type { Store } from '../persistence/loading-store/store'
import type { RateLimitService } from '../rate-limits/service/rate-limit-service'
import { normalizeClaudeRuntimeSelection } from '../claude-accounts/selection/runtime-selection'
import {
  CLAUDE_BACKGROUND_REFRESH_MS,
  claudeBackgroundPauseNow,
  createClaudeBackgroundGate,
  provideClaudeBackgroundGate
} from '../claude-limit-guard/claude-background-gate'
import type { ClaudeBackgroundPause } from '../../shared/claude-background-pause'
import {
  CLAUDE_BACKGROUND_HELD_DIR,
  catchUpHeldLaunchdJobs
} from '../claude-limit-guard/claude-background-launchd-catch-up'

export const CLAUDE_BACKGROUND_PAUSE_FILE = 'claude-background-pause.json'

function broadcast(pause: ClaudeBackgroundPause | null): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send('claudeLimitGuard:backgroundPauseChanged', pause)
    }
  }
}

function kickLaunchdJob(label: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const uid = process.getuid?.() ?? 0
    // Why: without -k a job that is already running is left alone — that run is the catch-up.
    execFile('launchctl', ['kickstart', `gui/${uid}/${label}`], { timeout: 10_000 }, (error) =>
      error ? reject(error) : resolve()
    )
  })
}

export function registerClaudeBackgroundPause(store: Store, rateLimits: RateLimitService): void {
  const userData = app.getPath('userData')
  const catchUpLaunchd = (): void => {
    // Why: elsewhere the jobs run from cron, whose next run is the catch-up.
    if (process.platform !== 'darwin' || claudeBackgroundPauseNow()) {
      return
    }
    void catchUpHeldLaunchdJobs({
      heldDir: join(userData, CLAUDE_BACKGROUND_HELD_DIR),
      kick: kickLaunchdJob,
      log: (line) => gate.note(line)
    })
  }
  // Why: the banner and the state file lift at the reset itself, not at the next refresh.
  let atReset: ReturnType<typeof setTimeout> | null = null
  const onChanged = (pause: ClaudeBackgroundPause | null): void => {
    broadcast(pause)
    if (atReset) {
      clearTimeout(atReset)
      atReset = null
    }
    if (pause?.resumesAt != null) {
      const wait = Math.min(Math.max(pause.resumesAt - Date.now() + 1_000, 1_000), 2_147_000_000)
      atReset = setTimeout(() => gate.evaluate(), wait)
      atReset.unref?.()
    }
    if (!pause) {
      catchUpLaunchd()
    }
  }
  const gate = createClaudeBackgroundGate({
    reading: () => rateLimits.usageReading('claude'),
    inactive: () => rateLimits.inactiveClaudeAccountsNow() ?? [],
    activeAccountId: () => normalizeClaudeRuntimeSelection(store.getSettings()).host,
    requestReading: (notWithinMs) => rateLimits.requestUsageReading('claude', { notWithinMs }),
    onReadingChange: (listener) => rateLimits.onStateChange(listener),
    now: Date.now,
    statePath: join(userData, CLAUDE_BACKGROUND_PAUSE_FILE),
    logPath: join(userData, 'claude-background-pause.log'),
    // Why: a live check in a development build stands a file in for the weekly window.
    ...(app.isPackaged
      ? {}
      : { testReadingPath: join(userData, 'claude-background-pause-test.json') }),
    onChanged
  })
  provideClaudeBackgroundGate(gate)
  ipcMain.handle('claudeLimitGuard:backgroundPause', () => claudeBackgroundPauseNow())
  // A new reading may start or end the pause: the banner and the state file follow it at once.
  rateLimits.onStateChange(() => gate.evaluate())
  const refresh = (): void => {
    gate.refresh()
    // Why: markers left while the app was closed, or by a job held back after the last change.
    catchUpLaunchd()
  }
  setTimeout(refresh, 60_000).unref?.()
  setInterval(refresh, CLAUDE_BACKGROUND_REFRESH_MS).unref?.()
}
