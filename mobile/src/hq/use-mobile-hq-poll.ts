// Custom build (hq-mobile): one HQ read polled from the Mac while its tab is open — HQ has no stream
// for clients off the Mac.
import { useCallback, useEffect, useState } from 'react'
import type { RpcClient } from '../transport/rpc-client'

const REFRESH_MS = 30_000

export type MobileHqPoll<T> =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  /** `loadedAt` dates the ages on the page. */
  | { status: 'ready'; value: T; loadedAt: number }

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function useMobileHqPoll<T>(
  client: RpcClient | null,
  /** Must keep one identity across renders (module scope or useCallback), or every render reloads. */
  read: (client: RpcClient) => Promise<{ value: T } | { error: string }>
): { state: MobileHqPoll<T>; refresh: () => void } {
  const [state, setState] = useState<MobileHqPoll<T>>({ status: 'loading' })
  const refresh = useCallback(() => {
    if (!client) {
      return
    }
    void read(client)
      .then((result) =>
        setState(
          'error' in result
            ? { status: 'error', message: result.error }
            : { status: 'ready', value: result.value, loadedAt: Date.now() }
        )
      )
      .catch((error: unknown) => setState({ status: 'error', message: errorText(error) }))
  }, [client, read])
  useEffect(() => {
    refresh()
    const timer = setInterval(refresh, REFRESH_MS)
    return () => clearInterval(timer)
  }, [refresh])
  return { state, refresh }
}
