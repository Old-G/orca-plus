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
    settings: Parameters<typeof withAutoGate>[1] & { hqRouterSendFirst?: boolean }
    router: Parameters<typeof withAutoGate>[2] & { logRoute: (entry: RouterLogEntry) => void }
    key: string
  },
  now: number = Date.now()
): HqRoute {
  const gated = input.mark
    ? withAutoGate(routed, input.settings, input.router, now)
    : { ...routed, auto: false }
  const done = withSendFirst(gated, input.mark, input.settings)
  input.router.logRoute({
    key: input.key,
    at: now,
    how: done.how,
    target: done.target,
    top: [done.target, ...done.alternatives.map((other) => other.sessionId)].slice(0, 3),
    // Why (T5): the middle zone sends too, so its row is auto=1; a failed send writes it back to 0.
    auto: done.auto || done.sendFirst === true,
    autoClass: done.autoClass,
    replace: input.mark
  })
  return done
}

/**
 * Router v2 T5 (owner 28.11): the middle zone — a 👾 whose route names a chat but did not pass the gate
 * (its class is still gathering, or a model picked) goes to that chat at once, with «check first»; on by
 * default, `hqRouterSendFirst: false` keeps the card waiting for «Send». A 🆕, a «new chat» pick and any
 * draft that is not a 👾 never do.
 */
export function withSendFirst(
  route: HqRoute,
  mark: boolean,
  settings: { hqRouterSendFirst?: boolean }
): HqRoute {
  const middle =
    mark &&
    !route.auto &&
    route.how !== 'new-mark' &&
    route.target !== 'new' &&
    settings.hqRouterSendFirst !== false
  return middle ? { ...route, sendFirst: true } : route
}
