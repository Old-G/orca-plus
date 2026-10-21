// Custom build (hq-promises, hq-remind, hq-reply-approve): bell lines that follow open waitings — the
// owner's promises due by tomorrow, people who have not answered for two working days, and answers
// waiting to be passed to their chat.
import { HQ_PROMISE_DUE_KIND, hqPromiseDueBellItems } from '../../shared/hq-promises'
import { HQ_REMIND_KIND, hqRemindBellItems } from '../../shared/hq-remind'
import { HQ_WAITING_REPLY_KIND, hqWaitingReplyBellItems } from '../../shared/hq-waiting-reply-bell'
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
  // Custom build (hq-reply-approve): answers wait here until the owner passes them on.
  deps.sync(HQ_WAITING_REPLY_KIND, hqWaitingReplyBellItems(open, deps.personName))
}

export function startHqWaitingBells(deps: HqWaitingBellsDeps): void {
  const run = (): void => syncHqWaitingBells(deps)
  deps.onChanged(run)
  setInterval(run, CHECK_MS).unref?.()
  run()
}
