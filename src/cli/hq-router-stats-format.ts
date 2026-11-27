// Custom build (hq-router T0, owner 28.11): `orca hq router-stats` as a table — one line per route class.
import type { HqRouterStats } from '../shared/hq-router-stats'
import type { HqRouterAutoStatus, HqRouterAutoThresholds } from '../shared/hq-router-auto'

function percent(part: number, whole: number): string {
  return whole === 0 ? '—' : `${Math.round((part / whole) * 100)}%`
}

/** Router v2 T4: one line per auto class — «auto», or «gathering n of minN», or below the share. */
export function formatHqRouterAuto(
  auto: { thresholds: HqRouterAutoThresholds; classes: HqRouterAutoStatus[] } | undefined
): string[] {
  if (!auto) {
    return []
  }
  const { minN, minRight, days } = auto.thresholds
  const width = Math.max(...auto.classes.map((entry) => entry.autoClass.length))
  return [
    '',
    `Auto send (last ${days} days: n ≥ ${minN}, right ≥ ${Math.round(minRight * 1000) / 10}%)`,
    ...auto.classes.map((entry) => {
      const status = entry.auto
        ? `auto (${entry.right} of ${entry.n} right)`
        : entry.n < minN
          ? `gathering: n ${entry.n} of ${minN}`
          : `waits on «Send»: ${entry.right} of ${entry.n} right (${percent(entry.right, entry.n)})`
      return `${entry.autoClass.padEnd(width)}  ${status}`
    })
  ]
}

export function formatHqRouterStats(result: HqRouterStats): string {
  if (result.classes.length === 0) {
    return [
      `No routed cards in the last ${result.days} days.`,
      ...formatHqRouterAuto(result.auto)
    ].join('\n')
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
  return [
    `Last ${result.days} days`,
    line(head),
    ...rows.map(line),
    ...formatHqRouterAuto(result.auto)
  ].join('\n')
}
