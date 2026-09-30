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

// Why: an agent session's env names that session's account home. Inherited by an app started from it
// (a ship, `open`), it became the app's "base" Claude login, and account switching then overwrote
// that subscription's sign-in instead of `~/.claude`.
const AGENT_SESSION_MARKERS = ['ORCA_AGENT_SESSION_ID', 'ORCA_STRUCTURED_SESSION', 'ORCA_PANE_KEY']
const AGENT_SESSION_ACCOUNT_ENV = ['CLAUDE_CONFIG_DIR', 'CODEX_HOME', 'ORCA_CLAUDE_SUBSCRIPTION']

/** Drops an agent session's identity and account home when the app was started from one. */
export function dropInheritedAgentSessionEnv(env: NodeJS.ProcessEnv): string[] {
  if (!AGENT_SESSION_MARKERS.some((name) => env[name])) {
    return []
  }
  const dropped = [...AGENT_SESSION_MARKERS, ...AGENT_SESSION_ACCOUNT_ENV].filter(
    (name) => env[name] !== undefined
  )
  for (const name of dropped) {
    delete env[name]
  }
  return dropped
}

export function applyOrcaPlusPackagedProfile(app: UserDataPaths, env: NodeJS.ProcessEnv): string {
  dropInheritedAgentSessionEnv(env)
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
