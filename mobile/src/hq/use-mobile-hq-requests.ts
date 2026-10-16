// Custom build (hq-mobile): HQ's requests and last week's decisions, polled from the Mac.
import { readHqRequests, type HqRequests } from '../../../src/shared/hq-requests-reply'
import { runRpcOperation } from '../transport/rpc-operation'
import type { RpcClient } from '../transport/rpc-client'
import { hqRequestsRead } from './hq-operations'
import { useMobileHqPoll, type MobileHqPoll } from './use-mobile-hq-poll'

export { errorText } from './use-mobile-hq-poll'

async function readRequests(client: RpcClient): Promise<{ value: HqRequests } | { error: string }> {
  const read = readHqRequests(await runRpcOperation(client, hqRequestsRead))
  return 'error' in read ? read : { value: read }
}

export function useMobileHqRequests(client: RpcClient | null): {
  state: MobileHqPoll<HqRequests>
  refresh: () => void
} {
  return useMobileHqPoll(client, readRequests)
}
