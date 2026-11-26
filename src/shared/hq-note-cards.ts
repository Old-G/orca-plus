// Custom build (hq-router T7b): the Notes lines that have an open «To work» card.
import { HQ_INTAKE_KIND, HQ_NOTE_CARD_KEY_PREFIX } from './hq-slack-intake'
import type { PulseInboxItem } from './pulse-types'

/** Ids of the Notes lines whose «To work» card is still open — the feed shows each line once. */
export function hqCardedNoteIds(inbox: readonly PulseInboxItem[]): Set<string> {
  return new Set(
    inbox.flatMap((item) =>
      item.kind === HQ_INTAKE_KIND &&
      !item.doneAt &&
      item.dedupeKey?.startsWith(HQ_NOTE_CARD_KEY_PREFIX)
        ? [item.dedupeKey.slice(HQ_NOTE_CARD_KEY_PREFIX.length)]
        : []
    )
  )
}
