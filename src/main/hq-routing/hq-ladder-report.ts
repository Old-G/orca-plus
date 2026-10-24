// Custom build (hq-plus-ladder): `orca hq ladder` — per kind of action, how the owner decided on what
// the system offered, the step HQ/routing.yaml gives it and the move the counts call for; plus the
// effort each chat message went with. Counts and kinds only: no row text leaves its room.
import { join } from 'node:path'
import {
  HQ_CHAT_EFFORT_KIND,
  HQ_OWNER_DECISION_KIND,
  hqLadderStats,
  readHqOwnerDecisionSource,
  type HqLadderReport
} from '../../shared/hq-ladder'
import {
  HQ_JOURNAL_MAX_LIMIT,
  type HqJournalEntry,
  type HqJournalQuery
} from '../../shared/hq-journal'
import { HQ_ROUTING_FILE } from '../../shared/hq-routing'
import { parseHqRouting } from './hq-routing-rules'

export type HqLadderReportDeps = {
  hqPath: () => string | null
  readText: (path: string) => Promise<string | null>
  list: (query: HqJournalQuery) => HqJournalEntry[]
  countBySource: (kind: string, since: number) => { source: string | null; count: number }[]
}

export async function hqLadderReport(
  deps: HqLadderReportDeps,
  since: number
): Promise<HqLadderReport> {
  const hq = deps.hqPath()
  const routing = parseHqRouting(hq ? await deps.readText(join(hq, HQ_ROUTING_FILE)) : null)
  const decisions = deps
    .list({ kind: HQ_OWNER_DECISION_KIND, since, limit: HQ_JOURNAL_MAX_LIMIT })
    .flatMap((entry) => {
      const read = readHqOwnerDecisionSource(entry.source)
      return read ? [{ ...read, at: entry.at }] : []
    })
  const effort = deps.countBySource(HQ_CHAT_EFFORT_KIND, since).flatMap(({ source, count }) => {
    const [, result, level] = source?.split(':') ?? []
    return result && level ? [{ result, effort: level, count }] : []
  })
  return {
    since,
    kinds: hqLadderStats(decisions, routing.ladder),
    effort,
    problems: routing.problems.filter((problem) => problem.startsWith('ladder'))
  }
}

let provided: ((since: number) => Promise<HqLadderReport>) | null = null

export function provideHqLadderReport(
  report: ((since: number) => Promise<HqLadderReport>) | null
): void {
  provided = report
}

export function getHqLadderReport(): ((since: number) => Promise<HqLadderReport>) | null {
  return provided
}
