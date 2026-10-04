import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PulseInboxItem } from '../../../shared/pulse-types'
import type { sendWebPush } from './web-push-sender'
import { WebPushService, webPushPayload } from './web-push-service'
import { WebPushStore, webPushFilePath } from './web-push-store'

const SUBSCRIPTION = {
  endpoint: 'https://web.push.apple.com/abc',
  p256dh: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  auth: 'BTBZMqHH6r4Tts7J_aSIgg',
  appUrl: 'https://mac.tail.ts.net/web-index.html'
}

function item(overrides: Partial<PulseInboxItem> = {}): PulseInboxItem {
  return {
    id: 'item-1',
    kind: 'agent-waiting',
    title: 'An agent needs your permission',
    body: 'orca-custom · Allow Bash?',
    urgency: 'urgent',
    refKind: 'pane',
    refId: null,
    actions: [],
    dedupeKey: 'waiting:pane-1:1',
    createdAt: 1,
    readAt: null,
    doneAt: null,
    doneAction: null,
    ...overrides
  }
}

describe('web push service', () => {
  let dir: string
  let store: WebPushStore
  let send: ReturnType<typeof vi.fn<typeof sendWebPush>>
  let paired: Set<string>
  let atMac: boolean

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'web-push-'))
    store = new WebPushStore(webPushFilePath(dir))
    send = vi.fn<typeof sendWebPush>(async () => 'sent')
    paired = new Set(['phone'])
    atMac = false
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  function service(): WebPushService {
    return new WebPushService({
      store,
      isDevicePaired: (deviceId) => paired.has(deviceId),
      isOwnerAtMac: () => atMac,
      openBellCount: () => 3,
      now: () => 42,
      send
    })
  }

  it('keeps one owner-only subscription per device and one key pair across restarts', () => {
    const first = service()
    first.subscribe('phone', SUBSCRIPTION)
    first.subscribe('phone', { ...SUBSCRIPTION, endpoint: 'https://web.push.apple.com/new' })
    const reloaded = new WebPushStore(webPushFilePath(dir))
    expect(reloaded.list()).toEqual([
      expect.objectContaining({ deviceId: 'phone', endpoint: 'https://web.push.apple.com/new' })
    ])
    expect(reloaded.vapid().publicKey).toBe(first.publicKey())
    expect(JSON.parse(readFileSync(webPushFilePath(dir), 'utf8')).vapid.privateKey).toBeTruthy()
  })

  it('refuses plain-http endpoints and app URLs, except an app page on loopback', () => {
    expect(() =>
      service().subscribe('phone', { ...SUBSCRIPTION, endpoint: 'http://evil.test/x' })
    ).toThrow(/https/)
    expect(() =>
      service().subscribe('phone', { ...SUBSCRIPTION, appUrl: 'http://mac.local/web-index.html' })
    ).toThrow(/https/)
    expect(() =>
      service().subscribe('phone', { ...SUBSCRIPTION, endpoint: 'http://127.0.0.1/push' })
    ).toThrow(/https/)
    service().subscribe('phone', {
      ...SUBSCRIPTION,
      appUrl: 'http://127.0.0.1:6768/web-index.html'
    })
    expect(store.get('phone')?.appUrl).toBe('http://127.0.0.1:6768/web-index.html')
  })

  it('pushes a bell item once, urgent items at high urgency, with a tap back into the app', async () => {
    const push = service()
    push.subscribe('phone', SUBSCRIPTION)
    await push.notifyBellItem(item())
    await push.notifyBellItem(item({ id: 'item-2' }))
    expect(send).toHaveBeenCalledTimes(1)
    const [call] = send.mock.calls[0]
    expect(call.options.urgency).toBe('high')
    expect(call.payload).toEqual({
      web_push: 8030,
      notification: {
        title: 'An agent needs your permission',
        body: 'orca-custom · Allow Bash?',
        navigate: 'https://mac.tail.ts.net/web-index.html?bell=item-1',
        tag: 'waiting:pane-1:1',
        silent: false,
        app_badge: '3'
      }
    })
  })

  it('stays quiet while the owner is at the Mac', async () => {
    atMac = true
    const push = service()
    push.subscribe('phone', SUBSCRIPTION)
    await push.notifyBellItem(item())
    expect(send).not.toHaveBeenCalled()
  })

  it('drops the subscription of an unpaired device instead of pushing to it', async () => {
    const push = service()
    push.subscribe('phone', SUBSCRIPTION)
    paired.clear()
    await push.notifyBellItem(item())
    expect(send).not.toHaveBeenCalled()
    expect(push.isSubscribed('phone')).toBe(false)
  })

  it('forgets a subscription its push service reports gone', async () => {
    send.mockResolvedValueOnce('gone')
    const push = service()
    push.subscribe('phone', SUBSCRIPTION)
    await push.notifyBellItem(item())
    expect(push.isSubscribed('phone')).toBe(false)
  })

  it('omits an empty body and the bell query when nothing is to open', () => {
    expect(
      webPushPayload(
        { title: 'On', body: null, urgent: false, bellItemId: null, tag: 't' },
        SUBSCRIPTION.appUrl,
        0
      )
    ).toEqual({
      web_push: 8030,
      notification: {
        title: 'On',
        navigate: SUBSCRIPTION.appUrl,
        tag: 't',
        silent: false,
        app_badge: '0'
      }
    })
  })
})
