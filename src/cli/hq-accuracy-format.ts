// Custom build (hq-attribution-log, owner 03.11): `orca hq accuracy` as the owner and his agents read it —
// how many cards went with a change, one line per source and field with kept / changed / skipped,
// then what he changes most and his own reasons.
import type { HqAttributionAccuracy } from '../shared/hq-attribution'

function percent(rate: number | null): string {
  return rate === null ? '  —' : `${Math.round(rate * 100)}%`.padStart(4)
}

/** One reason is stored on every field he changed on that card: print it once, naming those fields. */
function groupWhys(whys: HqAttributionAccuracy['whys']): string[] {
  const groups: { source: string; fields: string[]; text: string }[] = []
  for (const why of whys) {
    const last = groups.at(-1)
    if (last && last.text === why.text && last.source === why.source) {
      if (!last.fields.includes(why.field)) {
        last.fields.push(why.field)
      }
    } else {
      groups.push({ source: why.source, fields: [why.field], text: why.text })
    }
  }
  return groups.map(
    (group) =>
      `  ${group.source} · ${group.fields.join(', ')}: ${group.text.replace(/\s+/g, ' ').trim()}`
  )
}

export function formatHqAccuracy(result: HqAttributionAccuracy): string {
  if (result.slices.length === 0) {
    return 'No guesses decided yet: send cards to work from HQ+ and they are counted here.'
  }
  const lines: string[] = []
  if (result.cards.decided > 0) {
    const { decided, wrong } = result.cards
    lines.push(
      `Cards: ${decided} sent, ${decided - wrong} as HQ suggested, ${wrong} with a change`,
      ''
    )
  }
  for (const slice of result.slices) {
    lines.push(
      `${percent(slice.rate)}  ${`${slice.source} · ${slice.field}`.padEnd(18)} kept ${slice.confirmed}, changed ${slice.edited}, skipped ${slice.skipped}`
    )
  }
  if (result.topEdits.length > 0) {
    lines.push('', 'Changed most often:')
    for (const edit of result.topEdits) {
      lines.push(
        `  ${edit.count}×  ${edit.source} · ${edit.field}: ${edit.guess ?? '(none)'} → ${edit.final ?? '(none)'}`
      )
    }
  }
  if (result.whys.length > 0) {
    lines.push('', 'Your reasons, newest first:', ...groupWhys(result.whys))
  }
  return lines.join('\n')
}
