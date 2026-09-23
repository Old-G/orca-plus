import { join } from 'node:path'

// Custom build (orca-plus-packaging): a packaged Orca+ must never share the stock
// Orca's state. package.json's `name` is still "orca", so Electron would pick
// the same userData dir, and the bundled CLI and getOrcaUserDataPath() fall back
// to ".../orca" unless ORCA_USER_DATA_PATH says otherwise.

export const ORCA_PLUS_PROFILE_DIR_NAME = 'orca-plus'

type UserDataPaths = {
  getPath: (name: 'appData') => string
  setPath: (name: 'userData', path: string) => void
}

export function applyOrcaPlusPackagedProfile(app: UserDataPaths, env: NodeJS.ProcessEnv): string {
  const profileDir = join(app.getPath('appData'), ORCA_PLUS_PROFILE_DIR_NAME)
  app.setPath('userData', profileDir)
  // Why: terminals inherit this, so `orca`/`orca-plus` run there targets this app, not stock Orca.
  env.ORCA_USER_DATA_PATH = profileDir
  return profileDir
}

/**
 * Stock Orca's update feed would replace Orca+ with Orca, so Orca+ never checks it.
 * Why not under vitest: upstream's updater tests exercise the real flow.
 */
export const ORCA_PLUS_STOCK_UPDATES_DISABLED = import.meta.env.MODE !== 'test'

/**
 * Orca+ installs beside the stock Orca, which may own the Orca-managed hooks and
 * their trust entries in the real ~/.codex. Upstream's legacy sweep would delete
 * those on a fresh Orca+ profile, so Orca+ never runs it. Off under vitest, where
 * upstream's sweep tests exercise it.
 */
export const ORCA_PLUS_KEEPS_SHARED_CODEX_HOOKS = import.meta.env.MODE !== 'test'
