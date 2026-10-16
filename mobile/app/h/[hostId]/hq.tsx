import { useLocalSearchParams } from 'expo-router'
import { MobileWebShellScreen } from '../../../src/mobile-web-shell/MobileWebShellScreen'
import { PageRouteUnavailableScreen } from '../../../src/mobile-web-shell/PageRouteUnavailableScreen'
import { shellScreenRoute } from '../../../src/mobile-web-shell/shell-screen-route'
import { firstParam } from '../../../src/navigation/route-param-reader'

/** Custom build (hq-mobile): HQ exists only in the desktop's page, in `accounts.tsx`'s shape. */
export default function MobileHqRoute() {
  const params = useLocalSearchParams<{ hostId?: string | string[] }>()
  const hostId = firstParam(params.hostId)
  const route = hostId
    ? shellScreenRoute({ pathname: `/h/${encodeURIComponent(hostId)}/hq` })
    : null
  if (route === null) {
    return <PageRouteUnavailableScreen hostId={hostId} />
  }
  return <MobileWebShellScreen key={hostId} hostId={hostId} route={route} />
}
