// Custom build (page-bundle-freshness): whether the Mac now serves a newer page than the one on
// screen. The app swaps generations only when it mounts a screen afresh — a page already showing
// keeps its bytes across a reconnect — so a page that outlives a desktop update says so itself.
import { useEffect, useState } from 'react'
import { z } from 'zod'
import { MOBILE_WEB_BUNDLE_MANIFEST_METHOD } from '../../../src/shared/mobile-web-bundle/bundle-rpc-contract'
import type { RpcClient } from '../transport/rpc-client'
import { defineRpcOperation, runRpcOperation } from '../transport/rpc-operation'
import { rpcResultVariant } from '../transport/rpc-operation-result-reader'

const RECHECK_MS = 5 * 60_000

// Only the id: the page fetches no assets, so the asset list is not worth validating here.
const servedBuildIdRead = defineRpcOperation({
  name: 'mobileWeb.served-build-id',
  method: MOBILE_WEB_BUNDLE_MANIFEST_METHOD,
  acceptance: 'require-result-or-throw',
  barrier: 'on-settle',
  read: rpcResultVariant(
    'mobile-web-served-build-id',
    z.looseObject({ manifest: z.looseObject({ buildId: z.string().min(1) }) })
  )
})

/** The build id the Mac serves now, when it differs from `ownBuildId`; null while they agree. */
export function useNewerServedBuildId(client: RpcClient, ownBuildId: string | null): string | null {
  const [served, setServed] = useState<string | null>(null)
  useEffect(() => {
    if (ownBuildId === null) {
      return
    }
    let live = true
    const check = (): void => {
      if (client.getState() !== 'connected') {
        return
      }
      runRpcOperation(client, servedBuildIdRead, null)
        .then((reply) => {
          if (live) {
            setServed(reply.manifest.buildId)
          }
        })
        // A host without a bundle, or a link that dropped mid-read, says nothing about this page.
        .catch(() => undefined)
    }
    check()
    // A desktop update restarts the Mac's runtime, so the reconnect is when a newer page appears.
    const unsubscribe = client.onStateChange((state) => {
      if (state === 'connected') {
        check()
      }
    })
    const timer = setInterval(check, RECHECK_MS)
    return () => {
      live = false
      unsubscribe()
      clearInterval(timer)
    }
  }, [client, ownBuildId])
  return served !== null && served !== ownBuildId ? served : null
}
