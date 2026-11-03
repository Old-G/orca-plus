// Custom build (hq-attribution-log, owner 03.11): when the owner sends a card to work, HQ writes what
// the card proposed (project, chat) beside what he chose, so «how often is HQ right» is counted per
// source and field. Writing it never blocks or fails the send.
import { hqLedgerSignalOfCard } from '../../../../../shared/hq-ledger-from-inbox'
import { HQ_ATTRIBUTION_NEW_CHAT } from '../../../../../shared/hq-attribution'
import type { PulseInboxItem } from '../../../../../shared/pulse-types'
import { HQ_ROUTE_NEW_CHAT } from '../pulse-bell/hq-route-targets'
import { hqPlusCall } from './use-hq-plus-data'

const NO_LOOKUPS = { waitingRef: () => null, personAuthorId: () => null }

/** The conversation a card stands for: the one its card named, else the place the item names. */
export function hqPlusTakeKey(item: PulseInboxItem, cardKey: string | null): string | null {
  return cardKey ?? hqLedgerSignalOfCard(item, NO_LOOKUPS)?.key ?? null
}

/** A picker's chat value as the log keeps it: the session id, or `new`. */
export function hqPlusTakeChat(value: string): string {
  return value === HQ_ROUTE_NEW_CHAT ? HQ_ATTRIBUTION_NEW_CHAT : value.replace(/^chat:/, '')
}

export type HqPlusTakeChoice = {
  key: string | null
  proposedProject: string | null
  proposedChat: string
  project: string | null
  chat: string
  /** Custom build (owner 03.11): the card's kind, proposed and chosen, and his reason when he changed. */
  proposedKind: string | null
  /** Null when HQ proposed no kind: nothing to judge. */
  kind: string | null
  why: string
}

export function recordHqPlusTake(choice: HqPlusTakeChoice): void {
  if (!choice.key) {
    return
  }
  void hqPlusCall('hq.attributionTake', {
    key: choice.key,
    proposedProject: choice.proposedProject,
    proposedChat: hqPlusTakeChat(choice.proposedChat),
    project: choice.project,
    chat: hqPlusTakeChat(choice.chat),
    ...(choice.kind ? { proposedKind: choice.proposedKind, kind: choice.kind } : {}),
    ...(choice.why.trim() ? { why: choice.why.trim() } : {})
  }).then((result) => {
    if (!result.ok) {
      console.warn('[hq-attribution] could not record the choice:', result.message)
    }
  })
}
