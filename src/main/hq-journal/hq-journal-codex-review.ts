// Custom build (hq-plus-journal): the findings of the evening Codex review (`HQ/updates/
// codex-review-<date>T<HH-MM>.md`, written by the hq-commit-review skill) as journal rows, one per
// finding. P0/P1 wait for a fixing agent; P2 are noted and need nobody.
import { createHash } from 'node:crypto'
import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { HQ_JOURNAL_KIND, type HqJournalInput } from '../../shared/hq-journal'
import { hqJournalPlacement, hqJournalRoom, type HqJournalPlacer } from './hq-journal-adapters'

export const HQ_CODEX_REVIEW_DIR = 'updates'
const FILE = /^codex-review-(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})\.md$/
const PROJECT = /^## (.+?) · /
const FINDING = /^- \*\*\[P(\d)\] (.+?)\*\*(?: — `([^`]+)`)?\s*$/

export type HqCodexFinding = {
  project: string
  level: number
  title: string
  where: string | null
  detail: string
}

/** When the report was written, from its name, in local time; null for any other file. */
export function hqCodexReviewTime(fileName: string): number | null {
  const match = FILE.exec(fileName)
  if (!match) {
    return null
  }
  const [, year, month, day, hour, minute] = match.map(Number)
  return new Date(year, month - 1, day, hour, minute).getTime()
}

export function parseHqCodexReview(text: string): HqCodexFinding[] {
  const findings: HqCodexFinding[] = []
  let project: string | null = null
  let current: HqCodexFinding | null = null
  for (const line of text.split('\n')) {
    const heading = PROJECT.exec(line)
    const finding = FINDING.exec(line)
    if (heading) {
      project = heading[1].trim()
      current = null
    } else if (finding && project) {
      current = {
        project,
        level: Number(finding[1]),
        title: finding[2].trim(),
        where: finding[3]?.trim() ?? null,
        detail: ''
      }
      findings.push(current)
    } else if (current && /^\s{2,}\S/.test(line)) {
      current.detail = `${current.detail} ${line.trim()}`.trim()
    } else if (line.trim()) {
      current = null
    }
  }
  return findings
}

function fingerprint(finding: HqCodexFinding): string {
  return createHash('sha256')
    .update([finding.project, finding.level, finding.title, finding.where].join('\u0000'))
    .digest('hex')
    .slice(0, 16)
}

export function codexReviewJournal(
  fileName: string,
  text: string,
  place: HqJournalPlacer
): HqJournalInput[] {
  const at = hqCodexReviewTime(fileName)
  if (at === null) {
    return []
  }
  const file = `${HQ_CODEX_REVIEW_DIR}/${fileName}`
  return parseHqCodexReview(text).map((finding) => {
    const where = place({ project: finding.project })
    const serious = finding.level <= 1
    return {
      workspace: hqJournalRoom(where),
      placement: hqJournalPlacement(where),
      kind: HQ_JOURNAL_KIND.reviewFinding,
      at,
      project: where.project,
      address: null,
      sessionId: null,
      personId: null,
      title: `[P${finding.level}] ${finding.title}`,
      body: [finding.where ? `\`${finding.where}\`` : null, finding.detail || null]
        .filter(Boolean)
        .join('\n\n'),
      needs: serious ? 'agent:new' : 'nobody',
      status: serious ? 'open' : 'done',
      replyTo: null,
      refKind: 'file',
      refId: file,
      links: [{ kind: 'file', id: file }],
      source: 'codex-review',
      dedupeKey: `${HQ_JOURNAL_KIND.reviewFinding}:${fileName}:${fingerprint(finding)}`
    }
  })
}

/** The reports changed since `since`, oldest first; a missing folder is none. */
export async function readHqCodexReviews(
  hqPath: string,
  since: number
): Promise<{ fileName: string; text: string }[]> {
  const dir = join(hqPath, HQ_CODEX_REVIEW_DIR)
  const names = (await readdir(dir).catch(() => [])).filter((name) => FILE.test(name)).sort()
  const reports = await Promise.all(
    names.map(async (fileName) => {
      const path = join(dir, fileName)
      const changed = await stat(path).then(
        (info) => info.mtimeMs,
        () => 0
      )
      return changed >= since ? { fileName, text: await readFile(path, 'utf8') } : null
    })
  )
  return reports.filter((report): report is { fileName: string; text: string } => report !== null)
}
