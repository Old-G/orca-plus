// Custom build (hq-plus-ui): what the owner's HQ+ screen reads in one call, and the turn report's three
// fields as `orca hq report` writes them.
import type { HqJournalActivity, HqJournalEntry, HqSession } from './hq-journal'
import type { PulseInboxItem } from './pulse-types'

export const HQ_FEED_DEFAULT_LIMIT = 500
export const HQ_PLUS_FEED_WINDOW_MS = 7 * 24 * 60 * 60_000

export type HqFeedResult = {
  entries: HqJournalEntry[]
  sessions: HqSession[]
  /** The bell's decisions of the window, settled ones too, so a decided card keeps its place. */
  inbox: PulseInboxItem[]
  now: number
}

export type HqPlusReport = {
  done: string | null
  ask: string | null
  options: string[]
  next: string | null
  waitingOn: string | null
}

/** `Done: …\nQuestion: … (options: a | b)\nNext: …` as `orca hq report` writes it. */
export function parseHqPlusReport(body: string | null): HqPlusReport | null {
  if (!body) {
    return null
  }
  const report: HqPlusReport = { done: null, ask: null, options: [], next: null, waitingOn: null }
  for (const line of body.split('\n')) {
    const match = /^(Done|Question|Next|Waiting on):\s*(.*)$/.exec(line.trim())
    if (!match) {
      continue
    }
    const value = match[2].trim()
    if (match[1] === 'Done') {
      report.done = value
    } else if (match[1] === 'Next') {
      report.next = value
    } else if (match[1] === 'Waiting on') {
      report.waitingOn = value
    } else {
      const options = /\s*\(options: (.+)\)$/.exec(value)
      report.ask = options ? value.slice(0, options.index).trim() : value
      report.options = options ? options[1].split(' | ').map((option) => option.trim()) : []
    }
  }
  return report.done || report.ask || report.next ? report : null
}

/** What HQ's files and the 17.11 counter tell; a part this install cannot tell is null. */
export type HqPlusFileStats = {
  plan: { done: number; total: number; next: string | null } | null
  manual: { today: number; perDay: number | null } | null
}

/** `hq.screenStats`: the numbers on HQ+'s left and the week's work for its River. */
export type HqPlusScreenStats = HqPlusFileStats & {
  /** Journal rows of the last 24 hours, every room. */
  journalDay: number
  activity: HqJournalActivity[]
}

export type HqPlusReportSummary = {
  title: string | null
  /** Two or three short rows for the card. */
  rows: string[]
  /** The numbers of the proposals the owner answers «1 да, 2 нет» to. */
  proposals: number[]
  codex: { serious: number; minor: number } | null
}

const SUMMARY_ROW = 120

function clip(text: string): string {
  const plain = text
    .replace(/\*\*|`/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .trim()
  return plain.length > SUMMARY_ROW ? `${plain.slice(0, SUMMARY_ROW - 1)}…` : plain
}

/** A report file's first lines for its card: the proposals to decide, the Codex counts, or its opening. */
export function summarizeHqPlusReport(markdown: string, path: string): HqPlusReportSummary {
  const lines = markdown.split('\n')
  const title = lines.find((line) => /^#\s/.test(line))?.replace(/^#\s+/, '') ?? null
  if (/(^|\/)codex-review-[^/]+\.md$/.test(path)) {
    let serious = 0
    let minor = 0
    const rows: string[] = []
    let project: string | null = null
    for (const line of lines) {
      const heading = /^##\s+(.+?)(?:\s+\u00b7.*)?$/.exec(line)
      if (heading) {
        project = heading[1]
        continue
      }
      const finding = /^-\s+\*\*\[P(\d)\]\s*(.+?)\*\*/.exec(line)
      if (!finding) {
        continue
      }
      if (Number(finding[1]) <= 1) {
        serious += 1
        if (rows.length < 3) {
          rows.push(clip(`${project ? `${project}: ` : ''}${finding[2]}`))
        }
      } else {
        minor += 1
      }
    }
    return { title, rows, proposals: [], codex: { serious, minor } }
  }
  const proposals: number[] = []
  const rows: string[] = []
  let section: string | null = null
  for (const line of lines) {
    const heading = /^##\s+(.+)$/.exec(line)
    if (heading) {
      section = heading[1].trim()
      continue
    }
    const row = /^\|\s*(\d+)\s*\|\s*([^|]+)\|/.exec(line)
    if (row) {
      if (/\u0440\u0435\u0448|decide/i.test(section ?? '')) {
        proposals.push(Number(row[1]))
      }
      if (rows.length < 3) {
        rows.push(clip(`${row[1]} — ${row[2]}`))
      }
    }
  }
  if (rows.length === 0) {
    for (const line of lines) {
      const text = line.replace(/^[-*]\s+/, '').trim()
      if (text && !/^[#|>]/.test(text) && rows.length < 3) {
        rows.push(clip(text))
      }
    }
  }
  return { title, rows, proposals, codex: null }
}
