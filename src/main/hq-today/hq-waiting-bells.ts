// Custom build (hq-promises, hq-remind): bell lines that follow open waitings with the clock — the
// owner's promises due by tomorrow, and people who have not answered for two working days.
import { HQ_PROMISE_DUE_KIND, hqPromiseDueBellItems } from '../../shared/hq-promises'
import { HQ_REMIND_KIND, hqRemindBellItems } from '../../shared/hq-remind'
import type { PulseBellInput } from '../../shared/pulse-bell'
import type { PulseWaiting } from '../../shared/pulse-types'

// Why: a promise turns «due by tomorrow», and a question «unanswered», with the clock.
const CHECK_MS = 30 * 60_000

export type HqWaitingBellsDeps = {
  listOpen: () => PulseWaiting[]
  personName: (personId: string) => string | null
  sync: (kind: string, items: readonly PulseBellInput[]) => void
  onChanged: (listener: () => void) => void
  now: () => number
}

export function syncHqWaitingBells(deps: HqWaitingBellsDeps): void {
  const open = deps.listOpen()
  const now = deps.now()
  deps.sync(HQ_PROMISE_DUE_KIND, hqPromiseDueBellItems(open, deps.personName, now))
  deps.sync(HQ_REMIND_KIND, hqRemindBellItems(open, deps.personName, now))
}

export function startHqWaitingBells(deps: HqWaitingBellsDeps): void {
  const run = (): void => syncHqWaitingBells(deps)
  deps.onChanged(run)
  setInterval(run, CHECK_MS).unref?.()
  run()
}
