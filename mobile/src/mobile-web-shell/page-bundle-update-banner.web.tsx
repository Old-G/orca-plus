// Custom build (page-bundle-freshness): the page tells the owner when the Mac serves a newer one.
import { useState } from 'react'
import { HostRouteNoticeBanner } from '../components/HostRouteNoticeBanner'
import { usePageBridgeClient } from '../transport/client-context.web'
import { useNewerServedBuildId } from './page-bundle-freshness'

export const PAGE_BUNDLE_UPDATE_MESSAGE =
  'Your Mac has a newer version of these screens. Close Orca Mobile fully and open it again to load it.'

export function PageBundleUpdateBanner() {
  const client = usePageBridgeClient()
  const newer = useNewerServedBuildId(client, client.getShellSession()?.buildId ?? null)
  // Dismissed per served build, so the next desktop update speaks up again.
  const [dismissed, setDismissed] = useState<string | null>(null)
  if (newer === null || newer === dismissed) {
    return null
  }
  return (
    <HostRouteNoticeBanner
      message={PAGE_BUNDLE_UPDATE_MESSAGE}
      onDismiss={() => setDismissed(newer)}
    />
  )
}
