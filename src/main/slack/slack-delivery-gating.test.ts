import { describe, expect, it, vi } from 'vitest'
import type { BrowserWindow } from 'electron'
import { createNotificationDeliveryService } from '../notifications/notification-delivery-service'
import type { NotificationDispatchRequest } from '../../shared/notification-settings-types'

function makeWindow(focused: boolean): BrowserWindow {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the service reads only isFocused(); a full BrowserWindow cannot be constructed outside Electron.
  return { isFocused: () => focused } as unknown as BrowserWindow
}

function makeService(options: { focused: boolean; away?: boolean; desktopEnabled?: boolean }) {
  const slack = vi.fn()
  const service = createNotificationDeliveryService({
    readNotificationSettings: () => ({
      enabled: options.desktopEnabled ?? true,
      agentTaskComplete: true,
      terminalBell: true,
      suppressWhenFocused: false,
      customSoundId: 'system',
      customSoundPath: null,
      customSoundVolume: 1
    }),
    findActiveWindow: () => makeWindow(options.focused),
    isWindowVisible: () => true,
    setTrayAttention: vi.fn(),
    isNotificationSupported: () => true,
    dispatchMobileNotification: null,
    readAuthorizationStatus: () => Promise.resolve('authorized'),
    recordDeliveryOutcome: vi.fn(),
    deliverNative: () => ({ delivered: true }),
    platform: 'linux',
    now: () => 1_000,
    dispatchSlackNotification: slack,
    isDesktopAway: () => options.away
  })
  return { service, slack }
}

const done: NotificationDispatchRequest = {
  source: 'agent-task-complete',
  worktreeId: 'wt-1',
  agentState: 'done',
  isActiveWorktree: true
}

describe('Slack delivery gating', () => {
  it('stays quiet while the user watches this workspace', async () => {
    const { service, slack } = makeService({ focused: true })
    await service.dispatch(done)
    expect(slack).not.toHaveBeenCalled()
  })

  it('posts when the window is unfocused, the workspace inactive, or the user is away', async () => {
    for (const [options, request] of [
      [{ focused: false }, done],
      [{ focused: true }, { ...done, isActiveWorktree: false }],
      [{ focused: true, away: true }, done]
    ] as const) {
      const { service, slack } = makeService(options)
      await service.dispatch(request)
      expect(slack).toHaveBeenCalledWith(request)
    }
  })

  it('ignores the desktop toggles, bells and test notifications', async () => {
    const { service, slack } = makeService({ focused: false, desktopEnabled: false })
    await service.dispatch(done)
    await service.dispatch({ ...done, source: 'terminal-bell' })
    await service.dispatch({ ...done, source: 'test' })
    expect(slack).toHaveBeenCalledTimes(1)
  })
})
