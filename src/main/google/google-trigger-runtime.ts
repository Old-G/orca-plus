// Google rules ride the host's automation tick beside Look around, on desktop and `orca serve` alike.
import type { AutomationService } from '../automations/automation-service'
import type { Store } from '../persistence/loading-store/store'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import { googleApi } from './google-api-client'
// Custom build (google-disconnect-forget)
import { GOOGLE_RUN_EVENT_KEEP_MS } from '../persistence/scheduling-automations/automation-run-google-forget'
import { onGoogleAccountRemoved } from './google-account-forget'
import { listGoogleAccounts, readGoogleDefaultAccount } from './google-credential-store'
import { retirableGoogleTriggerChecker } from './google-trigger-retire'
import { readGoogleTriggerState, writeGoogleTriggerState } from './google-trigger-state'

const TICK_MS = 60_000
// Custom build (google-disconnect-forget): how often run history drops Google words past 30 days.
const RUN_HISTORY_SWEEP_MS = 60 * 60_000
// How long a disconnected account's runs are scrubbed again each tick: a run going at the disconnect,
// or an event already on its way into a run, saves its words when it settles. Only events from before
// the disconnect: the same address connected again keeps its new runs.
const REMOVED_ACCOUNT_SCRUB_MS = 6 * 60 * 60_000

export function bindGoogleTriggersToAutomations(
  service: Pick<AutomationService, 'onTick' | 'stop'>,
  store: Pick<Store, 'listAutomations' | 'getBots' | 'forgetAutomationRunGoogleEvents'>,
  runtime: Pick<OrcaRuntimeService, 'runAutomationForEvent'>
): void {
  // Custom build (google-disconnect-forget): retirable, so a disconnect drops the checker's memory.
  const checker = retirableGoogleTriggerChecker({
    automations: () => store.listAutomations(),
    bots: () => store.getBots(),
    accounts: async () =>
      (await listGoogleAccounts()).flatMap((entry) =>
        'record' in entry && entry.record.status === 'connected' ? [entry.record.email] : []
      ),
    defaultAccount: readGoogleDefaultAccount,
    api: (account) => googleApi(account),
    runForEvent: (automationId, event) => runtime.runAutomationForEvent(automationId, event),
    readState: () => readGoogleTriggerState(),
    writeState: (state) => writeGoogleTriggerState(state),
    now: () => Date.now(),
    tickMs: TICK_MS
  })
  // Custom build (google-disconnect-forget): a disconnected account's meetings, timers, in-flight
  // checks and run history go at once; every account's Gmail and Calendar words leave run history
  // after 30 days.
  const removedAt = new Map<string, number>()
  const stopForgetting = onGoogleAccountRemoved((email) => {
    checker.retire()
    const at = Date.now()
    removedAt.set(email.toLowerCase(), at)
    store.forgetAutomationRunGoogleEvents({ account: email, occurredBefore: at })
  })
  const scrubRemovedAccounts = () => {
    for (const [account, at] of removedAt) {
      if (Date.now() - at > REMOVED_ACCOUNT_SCRUB_MS) {
        removedAt.delete(account)
        continue
      }
      try {
        store.forgetAutomationRunGoogleEvents({ account, occurredBefore: at })
      } catch (error) {
        console.warn('[google] could not drop a disconnected account from run history', error)
      }
    }
  }
  let sweptAt = -Infinity
  const sweepRunHistory = () => {
    const now = Date.now()
    if (now - sweptAt < RUN_HISTORY_SWEEP_MS) {
      return
    }
    sweptAt = now
    try {
      store.forgetAutomationRunGoogleEvents({ before: now - GOOGLE_RUN_EVENT_KEEP_MS })
    } catch (error) {
      console.warn('[google] could not drop old Google events from run history', error)
    }
  }
  const lookAround = service.onTick
  service.onTick = () => {
    lookAround?.()
    scrubRemovedAccounts()
    sweepRunHistory()
    void checker.tick()
  }
  const stop = service.stop.bind(service)
  service.stop = () => {
    stopForgetting()
    checker.stop()
    stop()
  }
}
