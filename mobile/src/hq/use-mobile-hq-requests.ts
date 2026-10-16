// Custom build (hq-mobile): HQ's requests and last week's decisions, polled from the Mac while the
// page is open — HQ has no stream for clients off the Mac.
import { useCallback, useEffect, useState } from 'react'
import { readHqRequests, type HqRequests } from '../../../src/shared/hq-requests-reply'
import { runRpcOperation } from '../transport/rpc-operation'
import type { RpcClient } from '../transport/rpc-client'
import { hqRequestsRead } from './hq-operations'

const REFRESH_MS = 30_000

export type MobileHqRequestsState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  /** `loadedAt` dates the ages on the page. */
  | { status: 'ready'; requests: HqRequests; loadedAt: number }

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function useMobileHqRequests(client: RpcClient | null): {
  state: MobileHqRequestsState
  refresh: () => void
} {
  const [state, setState] = useState<MobileHqRequestsState>({ status: 'loading' })
  const refresh = useCallback(() => {
    if (!client) {
      return
    }
    void runRpcOperation(client, hqRequestsRead)
      .then((reply) => {
        const read = readHqRequests(reply)
        setState(
          'error' in read
            ? { status: 'error', message: read.error }
            : { status: 'ready', requests: read, loadedAt: Date.now() }
        )
      })
      .catch((error: unknown) => setState({ status: 'error', message: errorText(error) }))
  }, [client])
  useEffect(() => {
    refresh()
    const timer = setInterval(refresh, REFRESH_MS)
    return () => clearInterval(timer)
  }, [refresh])
  return { state, refresh }
}
