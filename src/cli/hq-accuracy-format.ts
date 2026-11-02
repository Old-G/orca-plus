// Custom build (hq-attribution-log, owner 03.11): `orca hq accuracy` as the owner and his agents read it —
// one line per source and field with kept / changed / skipped, then what he changes most.
import type { HqAttributionAccuracy } from '../shared/hq-attribution'

function percent(rate: number | null): string {
  return rate === null ? '  —' : `${Math.round(rate * 100)}%`.padStart(4)
}

export function formatHqAccuracy(result: HqAttributionAccuracy): string {
  if (result.slices.length === 0) {
    return 'No guesses decided yet: send cards to work from HQ+ and they are counted here.'
  }
  const lines = result.slices.map(
    (slice) =>
      `${percent(slice.rate)}  ${`${slice.source} · ${slice.field}`.padEnd(18)} kept ${slice.confirmed}, changed ${slice.edited}, skipped ${slice.skipped}`
  )
  if (result.topEdits.length > 0) {
    lines.push('', 'Changed most often:')
    for (const edit of result.topEdits) {
      lines.push(
        `  ${edit.count}×  ${edit.source} · ${edit.field}: ${edit.guess ?? '(none)'} → ${edit.final ?? '(none)'}`
      )
    }
  }
  return lines.join('\n')
}
