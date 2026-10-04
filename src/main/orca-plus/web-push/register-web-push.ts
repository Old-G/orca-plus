// Custom build (web-push): turns new bell items into pushes for paired phones.
import { powerMonitor } from 'electron'
import { getAppEnvironment } from '../../../shared/app-environment'
import type { PulseInboxItem } from '../../../shared/pulse-types'
import { readDesktopAwayState } from '../../notifications/desktop-away-state'
import type { OrcaRuntimeService } from '../../runtime/orca-runtime'
import { mainProcessState } from '../../startup/main-process-state'
import { onPulseChanged } from '../pulse/pulse-change-events'
import { WebPushService, setWebPushService } from './web-push-service'
import { WebPushStore, webPushFilePath } from './web-push-store'

// Why: startup re-raises every waiting agent the last run already announced.
const STARTUP_QUIET_MS = 2 * 60_000
const DRAIN_DEBOUNCE_MS = 300

function isInboxItem(payload: unknown): payload is PulseInboxItem {
  return (
    !!payload &&
    typeof payload === 'object' &&
    'id' in payload &&
    typeof payload.id === 'string' &&
    'title' in payload &&
    typeof payload.title === 'string'
  )
}

export function registerWebPush(runtime: OrcaRuntimeService): void {
  const service = new WebPushService({
    store: new WebPushStore(webPushFilePath(getAppEnvironment().getPath('userData'))),
    isDevicePaired: (deviceId) => {
      const registry = mainProcessState.runtimeRpc?.getDeviceRegistry()
      return registry ? Boolean(registry.getDevice(deviceId)) : null
    },
    // Unknown presence counts as away, like the native phone app's pushes.
    isOwnerAtMac: () => readDesktopAwayState(powerMonitor) === false,
    openBellCount: () => runtime.pulseListInbox(false).length,
    now: Date.now
  })
  setWebPushService(service)

  const startedAt = Date.now()
  let seq: number | null = null
  const drain = (): void => {
    try {
      if (seq === null) {
        seq = runtime.pulseEvents(Number.MAX_SAFE_INTEGER, 1).latestSeq
        return
      }
      const quiet = Date.now() - startedAt < STARTUP_QUIET_MS
      for (;;) {
        const page = runtime.pulseEvents(seq)
        for (const event of page.events) {
          seq = event.seq
          if (!quiet && event.kind === 'inbox.added' && isInboxItem(event.payload)) {
            void service.notifyBellItem(event.payload)
          }
        }
        if (page.events.length === 0 || seq >= page.latestSeq) {
          break
        }
      }
    } catch (error) {
      console.warn('[web-push] reading bell events failed:', error)
    }
  }
  drain()
  let timer: ReturnType<typeof setTimeout> | null = null
  onPulseChanged(() => {
    if (timer) {
      return
    }
    timer = setTimeout(() => {
      timer = null
      drain()
    }, DRAIN_DEBOUNCE_MS)
  })
}
