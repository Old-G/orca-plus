// Custom build (claude-background-pause): the desktop side of the background gate — the gate itself
// (shared with a headless orcad), the HQ banner's IPC, and the one catch-up run of launchd jobs held
// back in the pause.
import { app, BrowserWindow, ipcMain } from 'electron'
import { execFile } from 'node:child_process'
import { join } from 'node:path'
import type { Store } from '../persistence/loading-store/store'
import type { RateLimitService } from '../rate-limits/service/rate-limit-service'
import { claudeBackgroundPauseNow } from '../claude-limit-guard/claude-background-gate'
import { installClaudeBackgroundGate } from '../claude-limit-guard/claude-background-gate-host'
import type { ClaudeBackgroundPause } from '../../shared/claude-background-pause'
import {
  CLAUDE_BACKGROUND_HELD_DIR,
  catchUpHeldLaunchdJobs
} from '../claude-limit-guard/claude-background-launchd-catch-up'

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
  const { gate } = installClaudeBackgroundGate({
    store,
    rateLimits,
    userDataPath: userData,
    isPackaged: app.isPackaged,
    onPauseChanged: (pause) => {
      // Why: the banner lifts at the reset itself, not at the next refresh.
      broadcast(pause)
      if (!pause) {
        catchUpLaunchd()
      }
    },
    // Why: markers left while the app was closed, or by a job held back after the last change.
    onRefresh: catchUpLaunchd
  })
  ipcMain.handle('claudeLimitGuard:backgroundPause', () => claudeBackgroundPauseNow())
}
