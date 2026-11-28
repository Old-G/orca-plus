// Custom build (keychain-lockout, router v2 T6): the lockout check, wired to Electron and the bell.
import { homedir } from 'node:os'
import { join } from 'node:path'
import { Notification, powerMonitor } from 'electron'
import { getSecretStore } from '../../../shared/secure-storage/secret-store'
import { credentialFileHasContent } from '../../credentials/integration-credential-file'
import { getProfileUserDataPath } from '../../orca-profiles/profile-storage-paths'
import { showDesktopNotification } from '../../notifications/desktop-notification'
import type { PulseBellInput } from '../../../shared/pulse-bell'
import { KEYCHAIN_LOCKOUT_KIND, startKeychainLockoutWatch } from './keychain-lockout'

const PROBE = 'orca-plus-keychain-lockout-probe'

function secretsOpen(): boolean {
  try {
    const store = getSecretStore()
    return (
      store.isEncryptionAvailable() && store.decryptString(store.encryptString(PROBE)) === PROBE
    )
  } catch {
    return false
  }
}

export function registerKeychainLockout(deps: {
  syncBell: (kind: string, items: PulseBellInput[]) => void
  journal: (found: string) => void
}): void {
  const profile = getProfileUserDataPath()
  startKeychainLockoutWatch({
    platform: process.platform,
    secretsOpen,
    // Why these: the keys the 👾 poll, the ledger and the mail intake read (Slack bot and reader,
    // ClickUp, Gmail); the paths are the stores' own.
    sealed: [
      { service: 'Slack', path: join(profile, 'slack', 'credential.enc') },
      { service: 'Slack', path: join(profile, 'slack', 'reader.enc') },
      { service: 'ClickUp', path: join(homedir(), '.orca', 'clickup-credential.enc') },
      { service: 'Gmail', path: join(profile, 'gmail', 'token.enc') }
    ],
    hasContent: credentialFileHasContent,
    syncBell: (items) => deps.syncBell(KEYCHAIN_LOCKOUT_KIND, items),
    notify: (title, body) => {
      if (Notification.isSupported()) {
        showDesktopNotification(new Notification({ title, body }))
      }
    },
    journal: deps.journal,
    onOwnerBack: (run) => {
      powerMonitor.once('unlock-screen', run)
      powerMonitor.once('user-did-become-active', run)
    },
    schedule: (run, ms) => {
      setTimeout(run, ms).unref?.()
    },
    startedAt: Date.now()
  })
}
