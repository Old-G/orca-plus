// Custom build (keychain-lockout, router v2 T6, 28.11): every Orca+ build has a new code hash, and the
// Keychain item that seals the saved keys trusts builds one hash at a time, so each restart after a ship
// asks «Always Allow». macOS refuses that window outright in dark wake or with nobody at the Mac, and
// Chromium keeps the refusal for the whole run: Slack, ClickUp and Gmail went unread 03:10 → 10:15 with
// only an hourly journal line. This check names the lockout in the bell, the feed and a banner, and
// its button restarts Orca+ so the window comes up while the owner is there.
import { PULSE_BELL_ACTION, PULSE_BELL_KIND, type PulseBellInput } from '../../../shared/pulse-bell'

export const KEYCHAIN_LOCKOUT_KIND = PULSE_BELL_KIND.keychainLockout
// Why: the 👾 poll reads its key at 25 s; by then a refusal has happened and the probe adds no window.
export const KEYCHAIN_LOCKOUT_FIRST_CHECK_MS = 40_000

export type SealedCredential = { service: string; path: string }

export type KeychainLockoutDeps = {
  platform: NodeJS.Platform
  /** True when the secret store seals and opens a probe value in this run. */
  secretsOpen: () => boolean
  /** Saved keys sealed by the store, by service — the lockout matters only when some exist. */
  sealed: readonly SealedCredential[]
  hasContent: (path: string) => Promise<boolean>
  syncBell: (items: PulseBellInput[]) => void
  notify: (title: string, body: string) => void
  journal: (found: string) => void
  /** Calls back when the owner comes back to the Mac (screen unlocked, user active). */
  onOwnerBack: (run: () => void) => void
  schedule: (run: () => void, ms: number) => void
  startedAt: number
}

export function keychainLockoutBellItem(
  services: readonly string[],
  startedAt: number
): PulseBellInput {
  const names = services.join(', ')
  return {
    kind: KEYCHAIN_LOCKOUT_KIND,
    title: `${names}: saved keys locked — restart Orca+`,
    body:
      'macOS did not let Orca+ open its saved keys at this start (the Keychain window could not show: the Mac was asleep or nobody was there). ' +
      'Until a restart, 👾 and 🆕 marks, ClickUp comments and letters are not read. ' +
      'Restart, then press «Always Allow» in the Keychain window; marks set meanwhile are picked up after it.',
    urgency: 'urgent',
    refKind: KEYCHAIN_LOCKOUT_KIND,
    refId: null,
    actions: [{ id: PULSE_BELL_ACTION.restart, label: 'Restart Orca+' }],
    dedupeKey: `${KEYCHAIN_LOCKOUT_KIND}:${startedAt}`
  }
}

/** Services whose saved key exists; an empty file is no key. */
async function savedServices(deps: KeychainLockoutDeps): Promise<string[]> {
  const found = await Promise.all(
    deps.sealed.map(async (entry) => ((await deps.hasContent(entry.path)) ? entry.service : null))
  )
  return [...new Set(found.filter((service): service is string => service !== null))]
}

/** One check per run: Chromium keeps the Keychain's first answer until the process ends. */
export async function checkKeychainLockout(deps: KeychainLockoutDeps): Promise<string[]> {
  if (deps.platform !== 'darwin') {
    return []
  }
  if (deps.secretsOpen()) {
    // Why: a card left by the last run's lockout is over once this run opens the keys.
    deps.syncBell([])
    return []
  }
  const services = await savedServices(deps)
  if (services.length === 0) {
    return []
  }
  const item = keychainLockoutBellItem(services, deps.startedAt)
  deps.syncBell([item])
  deps.notify(item.title, 'Restart Orca+ and press «Always Allow» in the Keychain window.')
  deps.journal(`${services.join(', ')} not read: macOS refused the Keychain at this start`)
  // Why: a banner at 03:10 sinks in Notification Center; it repeats once the owner is back at the Mac.
  let repeated = false
  deps.onOwnerBack(() => {
    if (!repeated) {
      repeated = true
      deps.notify(item.title, 'Restart Orca+ and press «Always Allow» in the Keychain window.')
    }
  })
  return services
}

export function startKeychainLockoutWatch(deps: KeychainLockoutDeps): void {
  deps.schedule(() => {
    void checkKeychainLockout(deps).catch((error: unknown) =>
      console.warn('[keychain-lockout] check failed:', error)
    )
  }, KEYCHAIN_LOCKOUT_FIRST_CHECK_MS)
}
