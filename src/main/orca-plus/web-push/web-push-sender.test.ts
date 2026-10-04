import { createECDH } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { generateVapidKeys } from './web-push-crypto'
import { sendWebPush } from './web-push-sender'

const receiver = createECDH('prime256v1')
receiver.generateKeys()
const SUBSCRIPTION = {
  deviceId: 'phone',
  endpoint: 'https://web.push.apple.com/abc',
  keys: { p256dh: receiver.getPublicKey().toString('base64url'), auth: 'BTBZMqHH6r4Tts7J_aSIgg' },
  appUrl: 'https://mac.tail.ts.net/web-index.html',
  createdAt: 1
}

function sendWith(status: number): {
  result: ReturnType<typeof sendWebPush>
  fetchImpl: ReturnType<typeof vi.fn<typeof fetch>>
} {
  const fetchImpl = vi.fn<typeof fetch>(async () => new Response('', { status }))
  const result = sendWebPush({
    subscription: SUBSCRIPTION,
    vapid: generateVapidKeys(),
    payload: { web_push: 8030 },
    options: { urgency: 'high', ttlSeconds: 60 },
    fetchImpl
  })
  return { result, fetchImpl }
}

describe('sendWebPush', () => {
  it('posts an aes128gcm body with VAPID, TTL and urgency headers', async () => {
    const { result, fetchImpl } = sendWith(201)
    expect(await result).toBe('sent')
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe(SUBSCRIPTION.endpoint)
    expect(init?.method).toBe('POST')
    expect(init?.headers).toMatchObject({
      'Content-Encoding': 'aes128gcm',
      TTL: '60',
      Urgency: 'high',
      Authorization: expect.stringMatching(/^vapid t=.+, k=.+$/)
    })
  })

  it('reports gone for 404 and 410, failed for other errors', async () => {
    expect(await sendWith(410).result).toBe('gone')
    expect(await sendWith(404).result).toBe('gone')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(await sendWith(403).result).toBe('failed')
    warn.mockRestore()
  })
})
