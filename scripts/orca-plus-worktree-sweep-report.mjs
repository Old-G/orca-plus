// Custom build (worktree-sweep): the week's report scripts/orca-plus-worktree-sweep.mjs writes for
// HQ → Reports — removed by repo, kept by reason, the newest night on top.
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { DAY_MS } from './orca-plus-worktree-sweep-rules.mjs'

/** `2026-W48` — ISO week (Monday first) of a local date. */
export function isoWeek(now) {
  const d = new Date(now)
  const day = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  const weekday = day.getUTCDay() || 7
  day.setUTCDate(day.getUTCDate() + 4 - weekday)
  const yearStart = Date.UTC(day.getUTCFullYear(), 0, 1)
  const week = Math.ceil(((day.getTime() - yearStart) / DAY_MS + 1) / 7)
  return `${day.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}

/** A kept worktree's reason as a report group: «active 3 h ago» and «active 9 h ago» are one group. */
export function reasonGroup(reason) {
  if (/^active \d+ h ago$/.test(reason)) {
    return 'active in the last day'
  }
  if (/uncommitted file/.test(reason)) {
    return 'uncommitted files'
  }
  if (reason.startsWith('a process works in it')) {
    return 'a process works in it'
  }
  if (reason.includes('too big to keep a copy')) {
    return 'ignored files too big to copy'
  }
  if (reason.startsWith('removal failed')) {
    return 'removal failed'
  }
  if (reason.startsWith('holds another checkout')) {
    return 'holds another checkout'
  }
  if (reason.includes('hidden from git status')) {
    return 'tracked files hidden from git status'
  }
  return reason
}

const pad2 = (n) => String(n).padStart(2, '0')
const nightTitle = (now) => {
  const d = new Date(now)
  return `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}`
}

/**
 * One night's section of the week's report. `removed` and `kept` are rows; `onClose` is what chat
 * closes removed and kept since the last night (from the log).
 */
export function renderNight({ now, removed, kept, onClose, copies, attic }) {
  const d = new Date(now)
  const lines = [
    `## ${nightTitle(now)} ${pad2(d.getHours())}:${pad2(d.getMinutes())} — removed ${removed.length}, kept ${kept.length}`,
    ''
  ]
  if (onClose.removed.length > 0 || onClose.kept.length > 0) {
    lines.push(
      `On chat close since the last night: removed ${onClose.removed.length}${onClose.removed.length ? ` (${onClose.removed.join(', ')})` : ''}, kept ${onClose.kept.length}${onClose.kept.length ? ` (${onClose.kept.join(', ')})` : ''}.`,
      ''
    )
  }
  if (removed.length > 0) {
    lines.push('Removed:')
    const byRepo = new Map()
    for (const row of removed) {
      byRepo.set(row.repo, [...(byRepo.get(row.repo) ?? []), row.name])
    }
    for (const [repo, names] of [...byRepo].sort((a, b) => b[1].length - a[1].length)) {
      lines.push(`- ${repo} (${names.length}): ${names.join(', ')}`)
    }
    lines.push('')
  }
  if (kept.length > 0) {
    lines.push('Kept:')
    const byGroup = new Map()
    for (const row of kept) {
      const group = reasonGroup(row.reason)
      byGroup.set(group, [...(byGroup.get(group) ?? []), row])
    }
    for (const [group, rows] of [...byGroup].sort((a, b) => b[1].length - a[1].length)) {
      const names = rows.map((row) => {
        const name = `${row.repo} · ${row.name}`
        const detail = row.reason.startsWith(`${group}: `)
          ? row.reason.slice(group.length + 2)
          : row.reason
        return row.reason === group ? name : `${name} (${detail})`
      })
      lines.push(`- ${group} (${rows.length}): ${names.join(', ')}`)
    }
    lines.push('')
  }
  if (copies > 0) {
    lines.push(
      `Ignored files of ${copies} removed worktree(s) are copied to ${attic} for 30 days.`,
      ''
    )
  }
  return lines.join('\n')
}

const REPORT_FOOTER = [
  '---',
  'Bring a worktree back: `git worktree add <dir> refs/orca-plus-sweep/<YYYYMMDD>/<branch>-<sha12>` in its repo',
  '(`git for-each-ref refs/orca-plus-sweep` lists them), its ignored files: `tar -xzf <copy> -C <dir>`.',
  'Every removal, with its backup ref and copy: ~/Library/Logs/orca-plus-worktree-sweep.log.'
].join('\n')

/**
 * The week's report with this run's section on top of the earlier ones. What someone wrote below the
 * footer stays: the generated part ends there, and only that part is rebuilt (Codex P3 24.11).
 */
export function mergeWeekReport(existing, now, night) {
  const text = existing ?? ''
  const footerAt = text.indexOf(REPORT_FOOTER)
  const generated = footerAt === -1 ? text : text.slice(0, footerAt)
  const notes = footerAt === -1 ? '' : text.slice(footerAt + REPORT_FOOTER.length).trim()
  const sections = generated
    .split(/^(?=## )/m)
    .slice(1)
    .map((part) => part.split(/^---$/m)[0].trimEnd())
  return [
    `# Worktree cleanup · ${isoWeek(now)}`,
    '',
    night.trimEnd(),
    ...sections.flatMap((section) => ['', section]),
    '',
    REPORT_FOOTER,
    ...(notes ? ['', notes] : []),
    ''
  ].join('\n')
}

/**
 * What chat closes removed and kept since the last report, from the log. The last `run` line says how far
 * that report read (`readTo`, a byte offset); everything after it counts, whatever its time stamp, so a
 * close that finished while the night ran is in the next report (Codex P3 24.11). With no run yet: every
 * close in the log, so none is lost before the first report. `readTo` of the result is where this read stopped.
 */
export function closesSince(logFile) {
  const removed = []
  const kept = []
  let text = ''
  try {
    text = readFileSync(logFile, 'utf8')
  } catch {
    return { removed, kept, readTo: 0 }
  }
  const entries = []
  let offset = 0
  for (const line of text.split('\n')) {
    const at = offset
    offset += Buffer.byteLength(line) + 1
    try {
      entries.push({ at, entry: JSON.parse(line) })
    } catch {
      // A torn or foreign line says nothing.
    }
  }
  const lastRun = entries.findLast(({ entry }) => entry.event === 'run')
  const from = !lastRun
    ? 0
    : Number.isFinite(lastRun.entry.readTo)
      ? lastRun.entry.readTo
      : lastRun.at + 1
  for (const { at, entry } of entries) {
    if (at < from || entry.trigger !== 'chat-close') {
      continue
    }
    const name = `${entry.repo} · ${basename(entry.path ?? '')}`
    if (entry.event === 'removed') {
      removed.push(name)
    } else if (entry.event === 'kept') {
      kept.push(`${name}: ${entry.reasons?.[0] ?? 'kept'}`)
    } else if (entry.event === 'failed') {
      kept.push(`${name}: removal failed at ${entry.step ?? 'a step'}`)
    }
  }
  return { removed, kept, readTo: Buffer.byteLength(text) }
}
