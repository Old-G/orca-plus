// Custom build (hq-router auto classes, router v2 T4, owner 28.11): the gate between a 👾's route and its
// send by itself — the route's class against the router log, by the thresholds in the settings.
import type { HqRoute } from '../../shared/hq-router'
import { hqRouterAutoStatus, hqRouterAutoThresholds } from '../../shared/hq-router-auto'
import type { RouterLogEntry } from '../orca-plus/pulse/pulse-router-graph'

const DAY_MS = 24 * 60 * 60_000

/**
 * Router v2 T4: a 🆕 keeps its own send; any other route sends by itself only when its class passes the
 * thresholds in the settings over the router log — a model's pick has no class and never does.
 */
export function withAutoGate(
  route: HqRoute,
  settings: { hqRouterAuto?: Parameters<typeof hqRouterAutoThresholds>[0] },
  router: { autoRecords: (since: number) => Map<string, { n: number; right: number }> },
  now: number = Date.now()
): HqRoute {
  if (route.how === 'new-mark') {
    return route
  }
  if (!route.autoClass || route.target === 'new') {
    return { ...route, auto: false }
  }
  const thresholds = hqRouterAutoThresholds(settings.hqRouterAuto)
  const records = router.autoRecords(now - thresholds.days * DAY_MS)
  const status = hqRouterAutoStatus(route.autoClass, records.get(route.autoClass), thresholds)
  return { ...route, auto: status.auto }
}

/**
 * The route a draft takes and its line in the router log: a 👾 (`mark`) through the auto gate, any other
 * draft (a pasted link or text, a To work card) never sends by itself.
 */
export function gateAndLogRoute(
  routed: HqRoute,
  input: {
    mark: boolean
    settings: Parameters<typeof withAutoGate>[1]
    router: Parameters<typeof withAutoGate>[2] & { logRoute: (entry: RouterLogEntry) => void }
    key: string
  },
  now: number = Date.now()
): HqRoute {
  const done = input.mark
    ? withAutoGate(routed, input.settings, input.router, now)
    : { ...routed, auto: false }
  input.router.logRoute({
    key: input.key,
    at: now,
    how: done.how,
    target: done.target,
    top: [done.target, ...done.alternatives.map((other) => other.sessionId)].slice(0, 3),
    auto: done.auto,
    autoClass: done.autoClass,
    replace: input.mark
  })
  return done
}
