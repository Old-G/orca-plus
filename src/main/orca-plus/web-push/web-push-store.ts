// Custom build (web-push): this Mac's VAPID key pair and one push subscription per paired web
// device, in <userData>/orca-plus-web-push.json (owner-only, like the device registry).
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { writeSecureJsonFile } from '../../../shared/secure-file'
import { generateVapidKeys, type PushSubscriptionKeys, type VapidKeys } from './web-push-crypto'

export type WebPushSubscription = {
  deviceId: string
  endpoint: string
  keys: PushSubscriptionKeys
  /** The web client page that subscribed; a tap navigates back into it. */
  appUrl: string
  createdAt: number
}

type WebPushFile = { vapid: VapidKeys; subscriptions: WebPushSubscription[] }

export function webPushFilePath(userDataPath: string): string {
  return join(userDataPath, 'orca-plus-web-push.json')
}

function isSubscription(value: unknown): value is WebPushSubscription {
  if (!value || typeof value !== 'object') {
    return false
  }
  const entry: Partial<Record<keyof WebPushSubscription, unknown>> = value
  const keys: unknown = entry.keys
  return (
    typeof entry.deviceId === 'string' &&
    typeof entry.endpoint === 'string' &&
    typeof entry.appUrl === 'string' &&
    typeof entry.createdAt === 'number' &&
    !!keys &&
    typeof keys === 'object' &&
    'p256dh' in keys &&
    typeof keys.p256dh === 'string' &&
    'auth' in keys &&
    typeof keys.auth === 'string'
  )
}

function readFile(path: string): WebPushFile | null {
  if (!existsSync(path)) {
    return null
  }
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
    if (!parsed || typeof parsed !== 'object' || !('vapid' in parsed)) {
      return null
    }
    const vapid: unknown = parsed.vapid
    if (
      !vapid ||
      typeof vapid !== 'object' ||
      !('publicKey' in vapid) ||
      typeof vapid.publicKey !== 'string' ||
      !('privateKey' in vapid) ||
      typeof vapid.privateKey !== 'string'
    ) {
      return null
    }
    const subscriptions: unknown = 'subscriptions' in parsed ? parsed.subscriptions : []
    return {
      vapid: { publicKey: vapid.publicKey, privateKey: vapid.privateKey },
      subscriptions: Array.isArray(subscriptions) ? subscriptions.filter(isSubscription) : []
    }
  } catch {
    return null
  }
}

export class WebPushStore {
  private cache: WebPushFile | null = null

  constructor(private readonly path: string) {}

  private load(): WebPushFile {
    if (!this.cache) {
      // Why: a lost key pair only costs a re-subscribe; never refuse to start over it.
      this.cache = readFile(this.path) ?? { vapid: generateVapidKeys(), subscriptions: [] }
      if (!existsSync(this.path)) {
        this.save()
      }
    }
    return this.cache
  }

  private save(): void {
    if (this.cache) {
      writeSecureJsonFile(this.path, this.cache)
    }
  }

  vapid(): VapidKeys {
    return this.load().vapid
  }

  list(): readonly WebPushSubscription[] {
    return this.load().subscriptions
  }

  get(deviceId: string): WebPushSubscription | null {
    return this.list().find((entry) => entry.deviceId === deviceId) ?? null
  }

  /** One subscription per device: subscribing again replaces the old endpoint. */
  upsert(subscription: WebPushSubscription): void {
    const file = this.load()
    file.subscriptions = [
      ...file.subscriptions.filter((entry) => entry.deviceId !== subscription.deviceId),
      subscription
    ]
    this.save()
  }

  remove(deviceId: string, endpoint?: string): boolean {
    const file = this.load()
    const kept = file.subscriptions.filter(
      (entry) =>
        entry.deviceId !== deviceId || (endpoint !== undefined && entry.endpoint !== endpoint)
    )
    if (kept.length === file.subscriptions.length) {
      return false
    }
    file.subscriptions = kept
    this.save()
    return true
  }
}
