// Custom build (web-push): this browser's push subscription for the paired Mac's bell.
import { callRuntimeResult } from './preload-api/web-runtime-calls'

export type WebPushAvailability = 'available' | 'install-first' | 'unsupported'

export function webPushAvailability(): WebPushAvailability {
  if (
    window.isSecureContext &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  ) {
    return 'available'
  }
  // Why: iOS offers push only to the app added to the Home Screen, not to a Safari tab.
  return 'standalone' in navigator && navigator.standalone === false
    ? 'install-first'
    : 'unsupported'
}

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/'))
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

function sameKey(key: ArrayBuffer | null, publicKey: string): boolean {
  if (!key) {
    return false
  }
  const expected = base64UrlToBytes(publicKey)
  const actual = new Uint8Array(key)
  return (
    actual.length === expected.length && actual.every((byte, index) => byte === expected[index])
  )
}

export async function isWebPushEnabled(): Promise<boolean> {
  if (webPushAvailability() !== 'available' || Notification.permission !== 'granted') {
    return false
  }
  const registration = await navigator.serviceWorker.ready
  if (!(await registration.pushManager.getSubscription())) {
    return false
  }
  const status = await callRuntimeResult<{ subscribed: boolean }>('webPush.status')
  return status.subscribed
}

/** Must start inside a tap: iOS asks for permission only from a user gesture. */
export async function enableWebPush(): Promise<'enabled' | 'denied'> {
  if ((await Notification.requestPermission()) !== 'granted') {
    return 'denied'
  }
  const { publicKey } = await callRuntimeResult<{ publicKey: string }>('webPush.publicKey')
  const registration = await navigator.serviceWorker.ready
  let subscription = await registration.pushManager.getSubscription()
  // Why: a subscription made for another Mac's key would be refused by the push service.
  if (subscription && !sameKey(subscription.options.applicationServerKey, publicKey)) {
    await subscription.unsubscribe()
    subscription = null
  }
  subscription ??= await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: base64UrlToBytes(publicKey)
  })
  const json = subscription.toJSON()
  await callRuntimeResult('webPush.subscribe', {
    endpoint: subscription.endpoint,
    p256dh: json.keys?.p256dh ?? '',
    auth: json.keys?.auth ?? '',
    appUrl: `${location.origin}${location.pathname}`
  })
  await callRuntimeResult('webPush.test')
  return 'enabled'
}
