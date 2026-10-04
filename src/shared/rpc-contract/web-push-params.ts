// Custom build (web-push): params of the webPush.* RPC — a paired web client turning this Mac's
// bell notifications on or off for itself. The device is always the caller's paired identity.
import { z } from 'zod'

const boundedString = (message: string, max: number) =>
  z.string({ message }).min(1, message).max(max, message)

export const WebPushSubscribeParams = z.object({
  endpoint: boundedString('Push endpoint is required', 2048),
  p256dh: boundedString('Subscription key is required', 200),
  auth: boundedString('Subscription auth secret is required', 100),
  appUrl: boundedString('App URL is required', 2048)
})
