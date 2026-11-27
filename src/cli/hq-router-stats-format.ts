// Custom build (hq-router T0, owner 28.11): `orca hq router-stats` as a table — one line per route class.
import type { HqRouterStats } from '../shared/hq-router-stats'

function percent(part: number, whole: number): string {
  return whole === 0 ? '—' : `${Math.round((part / whole) * 100)}%`
}

export function formatHqRouterStats(result: HqRouterStats): string {
  if (result.classes.length === 0) {
    return `No routed cards in the last ${result.days} days.`
  }
  const rows = result.classes.map((entry) => [
    entry.how,
    String(entry.n),
    percent(entry.chatRight, entry.n),
    percent(entry.workRight, entry.n),
    percent(entry.top3, entry.n),
    `${Math.round(entry.share * 100)}%`,
    String(entry.skipped),
    String(entry.gone),
    String(entry.open)
  ])
  const head = ['class', 'n', 'chat', 'work', 'top3', 'share', 'skipped', 'gone', 'open']
  const widths = head.map((title, col) => Math.max(title.length, ...rows.map((r) => r[col].length)))
  const line = (cells: string[]): string =>
    cells
      .map((cell, col) => (col === 0 ? cell.padEnd(widths[col]) : cell.padStart(widths[col])))
      .join('  ')
  return [`Last ${result.days} days`, line(head), ...rows.map(line)].join('\n')
}
