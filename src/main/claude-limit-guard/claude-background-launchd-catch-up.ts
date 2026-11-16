// Custom build (claude-background-pause): a launchd job held back in the pause leaves a marker
// (claude-background-pause.held/<job>, written by hq-setup/claude_background_pause.py) naming its
// launchd label. Once the pause ends, each marked job is started once, so a daily roll-up skipped in
// the pause runs today rather than tomorrow; a job that was never held back is not touched.
import { readdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'

export const CLAUDE_BACKGROUND_HELD_DIR = 'claude-background-pause.held'

export type LaunchdCatchUpDeps = {
  heldDir: string
  /** Starts the launchd job once; rejects when launchd refused. */
  kick: (label: string) => Promise<void>
  log: (line: string) => void
}

// Why: only a reverse-DNS label reaches launchctl; anything else in a marker is not ours to start.
const LABEL = /^[A-Za-z0-9][A-Za-z0-9._-]*\.[A-Za-z0-9._-]+$/

function markerLabel(path: string): string | null {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as { label?: unknown }
    return typeof parsed.label === 'string' && LABEL.test(parsed.label) ? parsed.label : null
  } catch {
    return null
  }
}

let running: Promise<void> | null = null

/** Starts each held launchd job once; markers without a label wait for that job's own next run. */
export function catchUpHeldLaunchdJobs(deps: LaunchdCatchUpDeps): Promise<void> {
  // Why: the reset timer and the refresh may both fire; one pass must not start a job twice.
  running ??= runCatchUp(deps).finally(() => {
    running = null
  })
  return running
}

async function runCatchUp(deps: LaunchdCatchUpDeps): Promise<void> {
  let jobs: string[]
  try {
    jobs = readdirSync(deps.heldDir)
  } catch {
    return
  }
  for (const job of jobs) {
    const marker = join(deps.heldDir, job)
    const label = markerLabel(marker)
    if (!label) {
      continue
    }
    // Why: the marker goes first, so the job's own run of the helper does not log a second «on again».
    rmSync(marker, { force: true })
    try {
      await deps.kick(label)
      deps.log(`catch up ${job}: one run for what the pause skipped (launchd ${label})`)
    } catch (error) {
      deps.log(`catch up ${job}: launchd ${label} did not start (${String(error)})`)
    }
  }
}
