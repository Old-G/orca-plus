// Custom build (hq-bundled-skills): at startup the packaged app puts its HQ skills into the Claude skills
// folder every account shares (account folders link `skills` to ~/.claude/skills), and keeps the HQ
// folder pointer the skills' scripts read in step with Settings → HQ Folder.
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { app } from 'electron'
import type { Store } from '../persistence'
import { syncBundledHqSkills, writeHqPathPointer } from './hq-bundled-skills'

const BUNDLE_DIR = 'hq-skills'

function bundleRoot(): string | null {
  const candidates = app.isPackaged
    ? [join(process.resourcesPath, BUNDLE_DIR)]
    : [
        join(app.getAppPath(), 'resources', BUNDLE_DIR),
        join(process.cwd(), 'resources', BUNDLE_DIR)
      ]
  return candidates.find((dir) => existsSync(dir)) ?? null
}

export function hqPathPointerFile(): string {
  return join(homedir(), '.config', 'orca-plus', 'hq.json')
}

export function registerHqBundledSkills(store: Store): void {
  const log = (message: string): void => console.log('[hq-bundled-skills]', message)
  const pointTo = (hqPath: string | null | undefined): void => {
    writeHqPathPointer(hqPathPointerFile(), hqPath ?? null).catch((error: unknown) =>
      log(`pointer not written: ${String(error)}`)
    )
  }
  pointTo(store.getSettings().hqPath)
  store.onSettingsChanged((updates) => {
    if ('hqPath' in updates) {
      pointTo(updates.hqPath)
    }
  })
  // Why: a dev build or a test run must not rewrite the developer's own skills unless asked to.
  if (!app.isPackaged && process.env.ORCA_PLUS_HQ_SKILLS_SYNC !== '1') {
    return
  }
  const source = bundleRoot()
  if (!source) {
    log('bundle missing')
    return
  }
  syncBundledHqSkills(source, join(homedir(), '.claude', 'skills'))
    .then((result) => {
      if (result.handManagedBy) {
        log(`left alone: ~/.claude/skills/${result.handManagedBy} is not from Orca+`)
        return
      }
      log(
        `installed ${result.installed.length}, updated ${result.updated.length}, ` +
          `removed ${result.removed.length}, unchanged ${result.unchanged.length}`
      )
    })
    .catch((error: unknown) => log(`sync failed: ${String(error)}`))
}
