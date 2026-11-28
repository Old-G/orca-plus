import { describe, expect, it, vi } from 'vitest'
import {
  KEYCHAIN_LOCKOUT_FIRST_CHECK_MS,
  KEYCHAIN_LOCKOUT_KIND,
  checkKeychainLockout,
  startKeychainLockoutWatch,
  type KeychainLockoutDeps
} from './keychain-lockout'
import { PULSE_BELL_ACTION } from '../../../shared/pulse-bell'

function deps(overrides: Partial<KeychainLockoutDeps> = {}) {
  const owner: (() => void)[] = []
  const made = {
    platform: 'darwin' as NodeJS.Platform,
    secretsOpen: () => false,
    sealed: [
      { service: 'Slack', path: '/p/slack/credential.enc' },
      { service: 'Slack', path: '/p/slack/reader.enc' },
      { service: 'ClickUp', path: '/h/.orca/clickup-credential.enc' },
      { service: 'Gmail', path: '/p/gmail/token.enc' }
    ],
    hasContent: vi.fn(async (path: string) => !path.includes('gmail')),
    syncBell: vi.fn(),
    notify: vi.fn(),
    journal: vi.fn(),
    onOwnerBack: (run: () => void) => void owner.push(run),
    schedule: vi.fn(),
    startedAt: 1_000,
    ...overrides
  }
  return { made, owner }
}

describe('keychain lockout', () => {
  it('raises one card naming the locked services, with a restart button', async () => {
    const { made } = deps()
    expect(await checkKeychainLockout(made)).toEqual(['Slack', 'ClickUp'])
    expect(made.syncBell).toHaveBeenCalledTimes(1)
    const [items] = vi.mocked(made.syncBell).mock.calls[0]
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      kind: KEYCHAIN_LOCKOUT_KIND,
      urgency: 'urgent',
      title: 'Slack, ClickUp: saved keys locked — restart Orca+',
      dedupeKey: `${KEYCHAIN_LOCKOUT_KIND}:1000`
    })
    expect(items[0].actions).toEqual([{ id: PULSE_BELL_ACTION.restart, label: 'Restart Orca+' }])
    expect(items[0].body).toContain('Always Allow')
    expect(made.notify).toHaveBeenCalledTimes(1)
    expect(made.journal).toHaveBeenCalledWith(
      'Slack, ClickUp not read: macOS refused the Keychain at this start'
    )
  })

  it('tells the owner again once, on coming back to the Mac', async () => {
    const { made, owner } = deps()
    await checkKeychainLockout(made)
    for (const run of owner) {
      run()
    }
    expect(made.notify).toHaveBeenCalledTimes(2)
  })

  it('clears a card left by the last run when the keys open', async () => {
    const { made } = deps({ secretsOpen: () => true })
    expect(await checkKeychainLockout(made)).toEqual([])
    expect(made.syncBell).toHaveBeenCalledWith([])
    expect(made.notify).not.toHaveBeenCalled()
    expect(made.journal).not.toHaveBeenCalled()
  })

  it('says nothing when no key is saved', async () => {
    const { made } = deps({ hasContent: vi.fn(async () => false) })
    expect(await checkKeychainLockout(made)).toEqual([])
    expect(made.syncBell).not.toHaveBeenCalled()
    expect(made.notify).not.toHaveBeenCalled()
  })

  it('checks only on macOS, where the Keychain answers once per run', async () => {
    const { made } = deps({ platform: 'linux' })
    const secretsOpen = vi.fn(() => false)
    expect(await checkKeychainLockout({ ...made, secretsOpen })).toEqual([])
    expect(secretsOpen).not.toHaveBeenCalled()
    expect(made.syncBell).not.toHaveBeenCalled()
  })

  it('checks after the first poll has read its key', () => {
    const { made } = deps()
    startKeychainLockoutWatch(made)
    expect(made.schedule).toHaveBeenCalledWith(
      expect.any(Function),
      KEYCHAIN_LOCKOUT_FIRST_CHECK_MS
    )
    expect(KEYCHAIN_LOCKOUT_FIRST_CHECK_MS).toBeGreaterThan(25_000)
  })
})
