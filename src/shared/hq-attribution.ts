// Custom build (hq-attribution-log, owner 03.11): what HQ guessed about an incoming conversation — its
// project, the chat it goes to, its card's kind — beside what the owner then chose, so «how often is the
// guess right» is a number per source and field, not a feeling. Nothing here acts on its own: the owner
// presses every button, and the switch to automatic handling is his, later, on these numbers.

export const HQ_ATTRIBUTION_FIELDS = ['project', 'chat', 'kind', 'state'] as const
export type HqAttributionField = (typeof HQ_ATTRIBUTION_FIELDS)[number]

/** `confirm` — he kept what was guessed; `edit` — he chose otherwise; `skip` — he dropped the card,
 *  which says nothing about the guess. */
export type HqAttributionFinalHow = 'confirm' | 'edit' | 'skip'

/** Where a guess came from: a rule, a link or slug in the text, the model, the reader itself, the card
 *  the owner saw. `unrecorded` — the owner chose before any guess was written (older conversations);
 *  such rows are kept but never counted. */
export type HqAttributionGuessHow =
  | 'rule'
  | 'reply'
  | 'named'
  | 'model'
  | 'reader'
  | 'card'
  | 'unrecorded'

/** A chat field's value for «start a new chat». */
export const HQ_ATTRIBUTION_NEW_CHAT = 'new'

export type HqAttributionSlice = {
  source: string
  field: HqAttributionField
  /** Guesses the owner kept or changed; skips are apart. */
  decided: number
  confirmed: number
  edited: number
  skipped: number
  /** confirmed / decided, 0–1; null with nothing decided. */
  rate: number | null
}

export type HqAttributionEdit = {
  source: string
  field: HqAttributionField
  guess: string | null
  final: string | null
  count: number
}

export type HqAttributionAccuracy = {
  since: number
  slices: HqAttributionSlice[]
  /** What he changes most: «guessed X → chose Y», most frequent first. */
  topEdits: HqAttributionEdit[]
}

/** The source a conversation's place key names: `slack:…` → slack. */
export function hqAttributionSource(key: string): string {
  const head = /^([a-z]+):/.exec(key)?.[1]
  return head ?? 'other'
}
