// Custom build (hq-reports): HQ's «Reports» — the reports agents leave in HQ (the week's
// improvements, meeting follow-ups, status updates) in one list, each read with the owner's decisions
// dictated beside it and sent back to an HQ chat that carries them out.
import { z } from 'zod'

/** HQ folders that hold reports, newest file first in each. */
export const HQ_REPORT_FOLDERS = [
  'improvements',
  'meetings',
  'status-update',
  'updates',
  // Custom build (hq-daily-review): the day's review from the work journal.
  'daily'
] as const
export type HqReportFolder = (typeof HQ_REPORT_FOLDERS)[number]

export const HqReportSchema = z.object({
  /** HQ-relative, `improvements/2026-W42.md`. */
  path: z.string().max(500),
  title: z.string().max(300),
  folder: z.enum(HQ_REPORT_FOLDERS),
  /** Last change, epoch ms. */
  at: z.number(),
  /** Custom build (hq-spaces): the workspace a report under `workspaces/<slug>/` belongs to. */
  space: z.string().max(80).optional()
})
export type HqReport = z.infer<typeof HqReportSchema>

/** `improvements/x.md` or `workspaces/<slug>/improvements/x.md`: what the decisions RPC accepts. */
export const HQ_REPORT_PATH =
  /^(?:workspaces\/[a-z0-9][a-z0-9-]{0,62}\/)?(?:improvements|meetings|status-update|updates|daily)\/[^/\\]+\.md$/

export type HqReportsResult = { ok: true; reports: HqReport[] } | { ok: false; error: string }

export const HQ_REPORT_BELL_KIND = 'hq-report'
export const HQ_REPORT_OPEN_ACTION = 'open-report'
// Why: a report older than this is history, not something waiting for a decision.
export const HQ_REPORT_BELL_DAYS = 3

export const HQ_REPORT_DECISIONS_MAX = 8000

export function readHqReports(value: unknown): HqReport[] {
  const parsed = z.object({ reports: z.array(HqReportSchema) }).safeParse(value)
  return parsed.success ? parsed.data.reports : []
}

/** What the HQ chat gets: which report, the owner's words, and how to carry them out. */
export function hqReportDecisionsPrompt(
  report: Pick<HqReport, 'path' | 'folder'>,
  text: string
): string {
  const decisions = text.trim().slice(0, HQ_REPORT_DECISIONS_MAX)
  const how =
    report.folder === 'improvements'
      ? 'Примени по скиллу weekly-improve, шаг 5: только то, на что я сказал «да», и отметь в отчёте «Применено».'
      : report.folder === 'updates'
        ? 'Примени по скиллу upstream-updates: по одному, с проверкой и откатом, итог допиши в отчёт.'
        : report.folder === 'daily'
          ? 'Примени по скиллу daily-review, шаг «Применение»: только то, на что я сказал «да», и отметь в отчёте «Применено».'
          : 'Прочитай отчёт и выполни решения. Сообщения людям — только через Approve.'
  return `Решения по отчёту ${report.path}:\n${decisions}\n\n${how}`
}

/** The chat's tab name: «Report · 2026-W42». */
export function hqReportChatName(path: string): string {
  const file = path.split('/').at(-1) ?? path
  return `Report · ${file.replace(/\.md$/, '')}`
}
