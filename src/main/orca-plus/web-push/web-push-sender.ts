// Custom build (web-push): one encrypted POST to a browser's push service.
import { encryptPushPayload, vapidAuthorization, type VapidKeys } from './web-push-crypto'
import type { WebPushSubscription } from './web-push-store'

// Why: push services ask for a contact; this names the app, not the owner.
const VAPID_SUBJECT = 'https://github.com/stablyai/orca'
const TIMEOUT_MS = 15_000

export type WebPushSendResult = 'sent' | 'gone' | 'failed'

export type WebPushSendOptions = {
  urgency: 'normal' | 'high'
  /** Seconds the push service keeps the message for an offline phone. */
  ttlSeconds: number
}

export async function sendWebPush(args: {
  subscription: WebPushSubscription
  vapid: VapidKeys
  payload: object
  options: WebPushSendOptions
  fetchImpl?: typeof fetch
  nowSeconds?: number
}): Promise<WebPushSendResult> {
  const { subscription } = args
  try {
    const response = await (args.fetchImpl ?? fetch)(subscription.endpoint, {
      method: 'POST',
      headers: {
        Authorization: vapidAuthorization({
          endpoint: subscription.endpoint,
          keys: args.vapid,
          subject: VAPID_SUBJECT,
          nowSeconds: args.nowSeconds ?? Math.floor(Date.now() / 1000)
        }),
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        TTL: String(args.options.ttlSeconds),
        Urgency: args.options.urgency
      },
      body: new Uint8Array(
        encryptPushPayload(Buffer.from(JSON.stringify(args.payload)), subscription.keys)
      ),
      signal: AbortSignal.timeout(TIMEOUT_MS)
    })
    if (response.ok) {
      return 'sent'
    }
    // Why: 404/410 mean the browser dropped this subscription for good.
    if (response.status === 404 || response.status === 410) {
      return 'gone'
    }
    console.warn(
      `[web-push] ${new URL(subscription.endpoint).host} answered ${response.status}: ${(await response.text()).slice(0, 200)}`
    )
    return 'failed'
  } catch (error) {
    console.warn('[web-push] send failed:', error instanceof Error ? error.message : error)
    return 'failed'
  }
}
