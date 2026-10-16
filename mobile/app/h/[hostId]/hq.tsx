import { useLocalSearchParams } from 'expo-router'
import { MobileWebShellScreen } from '../../../src/mobile-web-shell/MobileWebShellScreen'
import { PageRouteUnavailableScreen } from '../../../src/mobile-web-shell/PageRouteUnavailableScreen'
import { shellScreenRoute } from '../../../src/mobile-web-shell/shell-screen-route'
import { shellSwitchDecision } from '../../../src/mobile-web-shell/shell-switch-decision'
import { firstParam } from '../../../src/navigation/route-param-reader'

/**
 * Custom build (hq-mobile): HQ exists only in the desktop's page, so the shell's switch has no native
 * screen to fall back to — it refuses, as the catch-all does.
 */
export default function MobileHqRoute() {
  const params = useLocalSearchParams<{ hostId?: string | string[] }>()
  const hostId = firstParam(params.hostId)
  const refusal = <PageRouteUnavailableScreen hostId={hostId} />
  const route = hostId
    ? shellScreenRoute({ pathname: `/h/${encodeURIComponent(hostId)}/hq` })
    : null
  const decision = shellSwitchDecision(route)
  if (decision.kind === 'native') {
    return refusal
  }
  return (
    <MobileWebShellScreen key={hostId} hostId={hostId} route={decision.route} fallback={refusal} />
  )
}
