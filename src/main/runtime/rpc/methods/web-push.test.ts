import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OrcaRuntimeService } from '../../orca-runtime'
import type { sendWebPush } from '../../../orca-plus/web-push/web-push-sender'
import { WebPushService, setWebPushService } from '../../../orca-plus/web-push/web-push-service'
import { WebPushStore, webPushFilePath } from '../../../orca-plus/web-push/web-push-store'
import { RpcDispatcher } from '../dispatcher'
import { WEB_PUSH_METHODS } from './web-push'

const SUBSCRIPTION = {
  endpoint: 'https://web.push.apple.com/abc',
  p256dh: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  auth: 'BTBZMqHH6r4Tts7J_aSIgg',
  appUrl: 'https://mac.tail.ts.net/web-index.html'
}

describe('webPush RPC methods', () => {
  let dir: string
  const send = vi.fn<typeof sendWebPush>(async () => 'sent')

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'web-push-rpc-'))
    send.mockClear()
    setWebPushService(
      new WebPushService({
        store: new WebPushStore(webPushFilePath(dir)),
        isDevicePaired: () => true,
        isOwnerAtMac: () => false,
        openBellCount: () => 0,
        now: () => 1,
        send
      })
    )
  })

  afterEach(() => {
    setWebPushService(null)
    rmSync(dir, { recursive: true, force: true })
  })

  const host = { getRuntimeId: () => 'runtime-test', getSubscriptionRegistrationVersion: () => 0 }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the dispatcher reads only the two ids above; webPush.* use the provided service, not the runtime.
  const runtime = host as unknown as OrcaRuntimeService
  const dispatcher = new RpcDispatcher({ runtime, methods: WEB_PUSH_METHODS })
  // Why: socket calls go through dispatchStreaming, the path that carries the paired device id.
  const call = async (
    method: string,
    params: unknown,
    caller: { clientKind?: 'mobile' | 'runtime'; pairedDeviceId?: string }
  ): Promise<unknown> => {
    const replies: string[] = []
    await dispatcher.dispatchStreaming(
      { id: randomUUID(), authToken: '', method, params },
      (reply) => replies.push(reply),
      caller
    )
    const response: unknown = JSON.parse(replies.at(-1) ?? 'null')
    if (!response || typeof response !== 'object' || !('ok' in response)) {
      throw new Error('no reply')
    }
    if (!response.ok) {
      throw new Error(JSON.stringify('error' in response ? response.error : response))
    }
    return 'result' in response ? response.result : undefined
  }
  const phone = { clientKind: 'runtime', pairedDeviceId: 'phone' } as const

  it('subscribes the calling web device and sends it a confirmation', async () => {
    await expect(call('webPush.status', undefined, phone)).resolves.toEqual({ subscribed: false })
    await call('webPush.subscribe', SUBSCRIPTION, phone)
    await expect(call('webPush.status', undefined, phone)).resolves.toEqual({ subscribed: true })
    await expect(call('webPush.test', undefined, phone)).resolves.toEqual({ result: 'sent' })
    expect(send.mock.calls[0][0].subscription.deviceId).toBe('phone')
    await expect(call('webPush.unsubscribe', undefined, phone)).resolves.toEqual({
      unsubscribed: true
    })
  })

  it('refuses callers that are not a paired web client', async () => {
    await expect(call('webPush.subscribe', SUBSCRIPTION, {})).rejects.toThrow(/paired web client/)
    await expect(
      call('webPush.subscribe', SUBSCRIPTION, { clientKind: 'mobile', pairedDeviceId: 'phone' })
    ).rejects.toThrow(/paired web client/)
  })

  it('hands out the public key to anyone paired', async () => {
    await expect(call('webPush.publicKey', undefined, phone)).resolves.toEqual({
      publicKey: expect.stringMatching(/^[A-Za-z0-9_-]{87}$/)
    })
  })
})
