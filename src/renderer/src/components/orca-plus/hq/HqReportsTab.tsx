// Custom build (hq-reports): HQ's «Reports» — the reports agents leave in HQ, newest first; one is
// read at a time with a box under it for the owner's decisions. At phone width the list and the
// report take turns on the whole width, as in the Wiki.
import { useCallback, useEffect, useState } from 'react'
import { List } from 'lucide-react'
import { readHqReports, type HqReport, type HqReportFolder } from '../../../../../shared/hq-reports'
import { Button } from '@/components/ui/button'
import CommentMarkdown from '@/components/sidebar/CommentMarkdown'
import { useNow } from '@/hooks/use-now'
import { translate } from '@/i18n/i18n'
import { formatShortTimeAgo } from '@/lib/short-time-ago'
import { hqWikiBody } from './hq-wiki-tree'
import { onHqReportRequested, takeRequestedHqReport } from './hq-report-target'
import { HqReportDecisions } from './HqReportDecisions'
import { useHqWikiPage } from './use-hq-wiki-page'

const REFRESH_MS = 60_000

function folderLabel(folder: HqReportFolder): string {
  switch (folder) {
    case 'improvements':
      return translate('auto.hq.reports.improvements', 'Week review')
    case 'meetings':
      return translate('auto.hq.reports.meetings', 'Meeting')
    case 'status-update':
      return translate('auto.hq.reports.status', 'Status update')
    case 'updates':
      return translate('auto.hq.reports.updates', 'Updates')
  }
}

type ListState = { reports: HqReport[]; error: string | null; loaded: boolean }

function useHqReports(): ListState {
  const [state, setState] = useState<ListState>({ reports: [], error: null, loaded: false })
  const load = useCallback(async () => {
    const result = await window.api.hqProjects.reports()
    setState(
      result.ok
        ? { reports: readHqReports(result), error: null, loaded: true }
        : (previous) => ({ ...previous, error: result.error, loaded: true })
    )
  }, [])
  useEffect(() => {
    const run = (): void =>
      void load().catch((error: unknown) =>
        setState((previous) => ({ ...previous, error: String(error), loaded: true }))
      )
    run()
    const timer = setInterval(run, REFRESH_MS)
    return () => clearInterval(timer)
  }, [load])
  return state
}

export function HqReportsTab(): React.JSX.Element {
  const now = useNow(REFRESH_MS)
  const { reports, error, loaded } = useHqReports()
  const [chosen, setChosen] = useState<string | null>(() => takeRequestedHqReport())
  const [listOpen, setListOpen] = useState(false)
  useEffect(
    () =>
      onHqReportRequested((path) => {
        takeRequestedHqReport()
        setChosen(path)
        setListOpen(false)
      }),
    []
  )
  const current = reports.find((report) => report.path === chosen) ?? reports[0] ?? null
  const page = useHqWikiPage(current?.path ?? null)

  if (loaded && reports.length === 0) {
    return (
      <p className="p-4 text-sm text-muted-foreground">
        {error ??
          translate(
            'auto.hq.reports.empty',
            'No reports yet. The week review, meeting follow-ups and status updates land here.'
          )}
      </p>
    )
  }
  return (
    <div className="flex h-full min-h-0">
      <nav
        data-open={listOpen}
        className="scrollbar-sleek flex w-72 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-border p-3 @max-xl/hq:w-full @max-xl/hq:border-r-0 @max-xl/hq:data-[open=false]:hidden"
        aria-label={translate('auto.hq.reports.list', 'Reports')}
      >
        {reports.map((report) => (
          <button
            key={report.path}
            type="button"
            title={report.path}
            aria-current={report.path === current?.path ? 'page' : undefined}
            onClick={() => {
              setChosen(report.path)
              setListOpen(false)
            }}
            className="flex flex-col gap-0.5 rounded-md px-2 py-1.5 text-left hover:bg-accent aria-[current=page]:bg-accent"
          >
            <span className="truncate text-[13px] font-medium">{report.title}</span>
            <span className="text-[11px] text-muted-foreground">
              {folderLabel(report.folder)} · {formatShortTimeAgo(report.at, now)}
            </span>
          </button>
        ))}
      </nav>
      <section
        data-open={listOpen}
        className="flex min-w-0 flex-1 flex-col @max-xl/hq:data-[open=true]:hidden"
      >
        <article className="scrollbar-sleek min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto flex max-w-3xl flex-col gap-3 p-6 @max-md/hq:p-4">
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                className="@xl/hq:hidden"
                onClick={() => setListOpen(true)}
                aria-label={translate('auto.hq.reports.list', 'Reports')}
              >
                <List />
              </Button>
              <span className="truncate font-mono text-xs text-muted-foreground">
                {current?.path}
              </span>
            </div>
            {page?.status === 'ready' ? (
              <CommentMarkdown
                variant="document"
                content={hqWikiBody(page.markdown)}
                className="text-sm"
              />
            ) : (
              <p className="text-sm text-muted-foreground">
                {page?.status === 'error'
                  ? translate('auto.hq.wiki.pageFailed', "Couldn't read this page: {{value0}}", {
                      value0: page.message
                    })
                  : translate('auto.hq.wiki.loading', 'Loading…')}
              </p>
            )}
          </div>
        </article>
        {current ? <HqReportDecisions key={current.path} report={current} /> : null}
      </section>
    </div>
  )
}
