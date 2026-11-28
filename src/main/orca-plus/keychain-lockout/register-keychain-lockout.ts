// Custom build (keychain-lockout, router v2 T6): the lockout check, wired to Electron and the bell.
import { open } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { Notification, powerMonitor } from 'electron'
import { getSecretStore } from '../../../shared/secure-storage/secret-store'
import { getProfileUserDataPath } from '../../orca-profiles/profile-storage-paths'
import { showDesktopNotification } from '../../notifications/desktop-notification'
import type { PulseBellInput } from '../../../shared/pulse-bell'
import { KEYCHAIN_LOCKOUT_KIND, startKeychainLockoutWatch } from './keychain-lockout'

const PROBE = 'orca-plus-keychain-lockout-probe'
// Why: Chromium's macOS safeStorage output starts with «v10»; the plaintext fallback never does.
const KEYCHAIN_SEALED_PREFIX = 'v10'

async function isKeychainSealed(path: string): Promise<boolean> {
  try {
    const file = await open(path, 'r')
    try {
      const head = Buffer.alloc(KEYCHAIN_SEALED_PREFIX.length)
      const { bytesRead } = await file.read(head, 0, head.length, 0)
      return bytesRead === head.length && head.toString('latin1') === KEYCHAIN_SEALED_PREFIX
    } finally {
      await file.close()
    }
  } catch {
    return false
  }
}

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
    isSealed: isKeychainSealed,
    syncBell: (items) => deps.syncBell(KEYCHAIN_LOCKOUT_KIND, items),
    notify: (title, body) => {
      if (Notification.isSupported()) {
        showDesktopNotification(new Notification({ title, body }))
      }
    },
    journal: deps.journal,
    onOwnerBack: (run) => {
      const back = (): void => {
        powerMonitor.off('unlock-screen', back)
        powerMonitor.off('user-did-become-active', back)
        run()
      }
      powerMonitor.on('unlock-screen', back)
      powerMonitor.on('user-did-become-active', back)
    },
    schedule: (run, ms) => {
      setTimeout(run, ms).unref?.()
    },
    startedAt: Date.now()
  })
}
