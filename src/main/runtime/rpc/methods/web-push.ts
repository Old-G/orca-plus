import { defineMethod, type RpcContext } from '../core'
import { WebPushSubscribeParams } from '../../../../shared/rpc-contract/web-push-params'
import {
  getWebPushService,
  type WebPushService
} from '../../../orca-plus/web-push/web-push-service'

function service(): WebPushService {
  const provided = getWebPushService()
  if (!provided) {
    throw new Error('Web push is not available on this host.')
  }
  return provided
}

// Why: a subscription belongs to a revocable paired web device, never to whatever the caller asserts.
function callerDevice({ clientKind, pairedDeviceId }: RpcContext): string {
  if (clientKind !== 'runtime' || !pairedDeviceId) {
    throw new Error('Only a paired web client can manage its notifications.')
  }
  return pairedDeviceId
}

// Custom build (web-push): a paired web client (the phone app) turns bell pushes on for itself.
export const WEB_PUSH_METHODS = [
  defineMethod({
    name: 'webPush.publicKey',
    params: null,
    handler: async () => ({ publicKey: service().publicKey() })
  }),
  defineMethod({
    name: 'webPush.status',
    params: null,
    handler: async (_params, context) => ({
      subscribed: service().isSubscribed(callerDevice(context))
    })
  }),
  defineMethod({
    name: 'webPush.subscribe',
    params: WebPushSubscribeParams,
    handler: async (params, context) => {
      service().subscribe(callerDevice(context), params)
      return { subscribed: true }
    }
  }),
  defineMethod({
    name: 'webPush.unsubscribe',
    params: null,
    handler: async (_params, context) => ({
      unsubscribed: service().unsubscribe(callerDevice(context))
    })
  }),
  defineMethod({
    name: 'webPush.test',
    params: null,
    handler: async (_params, context) => ({
      result: await service().sendToDevice(callerDevice(context), {
        title: 'Orca+ notifications are on',
        body: 'The bell reaches this phone while you are away from the Mac.',
        urgent: false,
        bellItemId: null,
        tag: 'web-push-test'
      })
    })
  })
]
