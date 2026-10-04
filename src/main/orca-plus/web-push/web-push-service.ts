// Custom build (web-push): who gets a push and what it says. Bell items reach every paired web
// device that turned notifications on, while the owner is away from this Mac.
import type { PulseInboxItem } from '../../../shared/pulse-types'
import { WEB_PUSH_BELL_QUERY } from '../../../shared/web-push-tap'
import { sendWebPush, type WebPushSendResult } from './web-push-sender'
import type { WebPushStore, WebPushSubscription } from './web-push-store'

const MAX_REMEMBERED_KEYS = 500

export type WebPushMessage = {
  title: string
  body: string | null
  urgent: boolean
  /** Bell item a tap opens; null opens the app as it was. */
  bellItemId: string | null
  /** Same tag replaces the phone's previous notification instead of stacking. */
  tag: string
}

export type WebPushSubscribeInput = {
  endpoint: string
  p256dh: string
  auth: string
  appUrl: string
}

export type WebPushServiceDeps = {
  store: WebPushStore
  /** null while the device registry is not up: unknown devices get nothing. */
  isDevicePaired: (deviceId: string) => boolean | null
  /** The owner is at this Mac now, so the phone stays quiet. */
  isOwnerAtMac: () => boolean
  openBellCount: () => number
  now: () => number
  send?: typeof sendWebPush
}

/** Declarative Web Push (WebKit) — the phone shows it even with no service worker running. */
export function webPushPayload(message: WebPushMessage, appUrl: string, badge: number): object {
  const navigate = new URL(appUrl)
  if (message.bellItemId) {
    navigate.searchParams.set(WEB_PUSH_BELL_QUERY, message.bellItemId)
  }
  return {
    web_push: 8030,
    notification: {
      title: message.title,
      ...(message.body ? { body: message.body } : {}),
      navigate: navigate.href,
      tag: message.tag,
      silent: false,
      app_badge: String(badge)
    }
  }
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

/** https, or for the app page also a loopback http page — both are secure contexts to a browser. */
function requireSecureUrl(value: string, what: string, allowLoopback: boolean): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error(`${what} is not a URL.`)
  }
  const loopback = allowLoopback && url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname)
  if (url.protocol !== 'https:' && !loopback) {
    throw new Error(`${what} must be https.`)
  }
  return url.href
}

export class WebPushService {
  private readonly pushedKeys: string[] = []

  constructor(private readonly deps: WebPushServiceDeps) {}

  publicKey(): string {
    return this.deps.store.vapid().publicKey
  }

  subscribe(deviceId: string, input: WebPushSubscribeInput): void {
    this.deps.store.upsert({
      deviceId,
      endpoint: requireSecureUrl(input.endpoint, 'Push endpoint', false),
      keys: { p256dh: input.p256dh, auth: input.auth },
      appUrl: requireSecureUrl(input.appUrl, 'App URL', true),
      createdAt: this.deps.now()
    })
  }

  unsubscribe(deviceId: string): boolean {
    return this.deps.store.remove(deviceId)
  }

  isSubscribed(deviceId: string): boolean {
    return this.deps.store.get(deviceId) !== null
  }

  async sendToDevice(deviceId: string, message: WebPushMessage): Promise<WebPushSendResult> {
    const subscription = this.deps.store.get(deviceId)
    return subscription ? this.deliver(subscription, message) : 'gone'
  }

  /** A new bell item: once per dedupe key, and only while the owner is away. */
  async notifyBellItem(item: PulseInboxItem): Promise<void> {
    const key = item.dedupeKey ?? item.id
    if (this.pushedKeys.includes(key) || this.deps.isOwnerAtMac()) {
      return
    }
    this.pushedKeys.push(key)
    this.pushedKeys.splice(0, Math.max(0, this.pushedKeys.length - MAX_REMEMBERED_KEYS))
    const message: WebPushMessage = {
      title: item.title,
      body: item.body,
      urgent: item.urgency === 'urgent',
      bellItemId: item.id,
      tag: key
    }
    await Promise.all(
      this.deps.store.list().map((subscription) => this.deliver(subscription, message))
    )
  }

  private async deliver(
    subscription: WebPushSubscription,
    message: WebPushMessage
  ): Promise<WebPushSendResult> {
    const paired = this.deps.isDevicePaired(subscription.deviceId)
    if (paired === false) {
      // Why: an unpaired phone must stop seeing what this Mac's agents are doing.
      this.deps.store.remove(subscription.deviceId)
      return 'gone'
    }
    if (paired === null) {
      return 'failed'
    }
    const result = await (this.deps.send ?? sendWebPush)({
      subscription,
      vapid: this.deps.store.vapid(),
      payload: webPushPayload(message, subscription.appUrl, this.deps.openBellCount()),
      options: { urgency: message.urgent ? 'high' : 'normal', ttlSeconds: 24 * 60 * 60 }
    })
    if (result === 'gone') {
      this.deps.store.remove(subscription.deviceId, subscription.endpoint)
    }
    return result
  }
}

let service: WebPushService | null = null

export function setWebPushService(next: WebPushService | null): void {
  service = next
}

export function getWebPushService(): WebPushService | null {
  return service
}
