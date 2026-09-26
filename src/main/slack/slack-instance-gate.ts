// Custom build (slack-dev-gate): keeps a dev build off the Slack app the installed Orca+ uses.
import { app } from 'electron'

/** Why: Socket Mode hands each event to ONE connection, so a dev build on the same app token
 *  would steal the installed app's replies. Dev builds opt in with ORCA_DEV_SLACK=1. */
export function isSlackPausedForThisInstance(
  env: NodeJS.ProcessEnv = process.env,
  isPackaged: boolean = app.isPackaged
): boolean {
  return !isPackaged && env.ORCA_DEV_SLACK !== '1'
}
