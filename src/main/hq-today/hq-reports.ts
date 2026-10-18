// Custom build (hq-reports): the reports in HQ's report folders, newest first, and one bell item per
// report changed in the last few days, so a new report reaches the owner without him looking.
import { open, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import {
  HQ_REPORT_BELL_DAYS,
  HQ_REPORT_BELL_KIND,
  HQ_REPORT_FOLDERS,
  HQ_REPORT_OPEN_ACTION,
  type HqReport
} from '../../shared/hq-reports'
import { PULSE_BELL_ACTION, type PulseBellInput } from '../../shared/pulse-bell'
import { headingOf } from '../hq-project-pages/hq-wiki-files'
import { HQ_SPACE_SLUG, HQ_SPACES_DIR } from '../../shared/hq-spaces'

const MAX_REPORTS = 60
const HEAD_BYTES = 4096
const REFRESH_MS = 5 * 60_000

async function readHead(path: string): Promise<string> {
  const file = await open(path, 'r')
  try {
    const buffer = Buffer.alloc(HEAD_BYTES)
    const { bytesRead } = await file.read(buffer, 0, HEAD_BYTES, 0)
    return buffer.subarray(0, bytesRead).toString('utf8')
  } finally {
    await file.close()
  }
}

/** Every `.md` straight inside a report folder — the global HQ's and each workspace's
 *  (`workspaces/<slug>/<folder>`); a missing folder is just empty. */
export async function listHqReports(hqPath: string): Promise<HqReport[]> {
  // Custom build (hq-spaces): a workspace's own reports live under its folder.
  const spaces = (
    await readdir(join(hqPath, HQ_SPACES_DIR), { withFileTypes: true }).catch(() => [])
  )
    .filter((entry) => entry.isDirectory() && HQ_SPACE_SLUG.test(entry.name))
    .map((entry) => entry.name)
  const roots: { prefix: string; space?: string }[] = [
    { prefix: '' },
    ...spaces.map((space) => ({ prefix: `${HQ_SPACES_DIR}/${space}/`, space }))
  ]
  const perFolder = await Promise.all(
    roots
      .flatMap((root) => HQ_REPORT_FOLDERS.map((folder) => ({ ...root, folder })))
      .map(async ({ prefix, space, folder }) => {
        const names = await readdir(join(hqPath, prefix, folder)).catch(() => [])
        return Promise.all(
          names
            .filter((name) => name.endsWith('.md'))
            .map(async (name): Promise<HqReport | null> => {
              const full = join(hqPath, prefix, folder, name)
              try {
                const [info, head] = await Promise.all([stat(full), readHead(full)])
                return info.isFile()
                  ? {
                      path: `${prefix}${folder}/${name}`,
                      title: (headingOf(head) ?? name.replace(/\.md$/, '')).slice(0, 300),
                      folder,
                      at: Math.round(info.mtimeMs),
                      ...(space ? { space } : {})
                    }
                  : null
              } catch {
                return null
              }
            })
        )
      })
  )
  return perFolder
    .flat()
    .filter((report): report is HqReport => report !== null)
    .sort((a, b) => b.at - a.at)
    .slice(0, MAX_REPORTS)
}

export function hqReportBellItem(report: HqReport): PulseBellInput {
  return {
    kind: HQ_REPORT_BELL_KIND,
    title: 'A new report in HQ',
    body: report.title,
    refKind: 'hq-report',
    refId: report.path,
    actions: [
      { id: HQ_REPORT_OPEN_ACTION, label: 'Open' },
      { id: PULSE_BELL_ACTION.dismiss, label: 'Not now' }
    ],
    // Why: one item per report; once the owner answers it, the same report does not come back.
    dedupeKey: `hq-report:${report.path}`
  }
}

export type HqReportBellDeps = {
  hqPath: () => string | null
  /** Returns how many items it raised. */
  sync: (kind: string, items: readonly PulseBellInput[]) => number
  /** A desktop banner and a phone push for a report that just arrived. */
  notify: (report: HqReport) => void
  now: () => number
}

/** One pass; `known` holds the reports already seen, so only one written since then is announced. */
export async function refreshHqReportBell(
  deps: HqReportBellDeps,
  known: Set<string> | null
): Promise<Set<string>> {
  const hq = deps.hqPath()
  const since = deps.now() - HQ_REPORT_BELL_DAYS * 24 * 60 * 60_000
  const recent = (hq ? await listHqReports(hq) : []).filter((report) => report.at >= since)
  const raised = deps.sync(HQ_REPORT_BELL_KIND, recent.map(hqReportBellItem))
  // Why: on the first pass after a start every recent report is «new»; that is not news.
  const fresh = known ? recent.filter((report) => !known.has(report.path)) : []
  if (raised > 0 && fresh[0]) {
    deps.notify(fresh[0])
  }
  return new Set([...(known ?? []), ...recent.map((report) => report.path)])
}

export function startHqReportBell(deps: HqReportBellDeps): () => void {
  let known: Set<string> | null = null
  const refresh = async (): Promise<void> => {
    known = await refreshHqReportBell(deps, known)
  }
  const run = (): void =>
    void refresh().catch((error: unknown) =>
      console.warn('[hq-reports] bell failed:', error instanceof Error ? error.message : error)
    )
  run()
  const timer = setInterval(run, REFRESH_MS)
  timer.unref?.()
  return () => clearInterval(timer)
}
