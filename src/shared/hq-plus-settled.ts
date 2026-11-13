// Custom build (hq-plus-instant, Codex 14.11): cards the owner just settled, shown closed before a
// read confirms it. Laid on the day's rows before they fold by conversation, so a card folded into a
// conversation leaves its parts, and the conversation closes with its last one, as the next read will
// have it.
import type { HqPlusDone, HqPlusLogItem } from './hq-plus-log'

/** Cards the owner just settled, by card id, with what was chosen. */
export type HqPlusSettled = ReadonlyMap<string, { done: HqPlusDone }>

export function hqPlusWithSettled(
  rows: readonly HqPlusLogItem[],
  settled: HqPlusSettled
): readonly HqPlusLogItem[] {
  if (settled.size === 0) {
    return rows
  }
  return rows.map((row) => {
    const held = row.kind === 'card' && row.open ? settled.get(row.id) : undefined
    return held ? { ...row, open: false, done: held.done } : row
  })
}
