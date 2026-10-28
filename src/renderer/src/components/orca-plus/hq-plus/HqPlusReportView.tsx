// Custom build (hq-plus-ui): a report read inside HQ+'s right panel, with the same markdown Reports uses;
// «In Reports» opens it in classic HQ, where every report stays listed.
// Custom build (hq-plus-side-blocks): with none open, the tab lists every report, newest first.
// Custom build (hq-plus-report-chat): an open report has the classic Reports' decisions box under it.
import CommentMarkdown from '@/components/sidebar/CommentMarkdown'
import { translate } from '@/i18n/i18n'
import { hqWikiBody } from '../hq/hq-wiki-tree'
import { requestHqReport } from '../hq/hq-report-target'
import { openHqScreen } from '../hq/hq-view'
import { useHqWikiPage } from '../hq/use-hq-wiki-page'
import { setHqFlavor } from './hq-plus-flavor'
import { folderLabel, useHqReports } from '../hq/HqReportsTab'
import { HqReportDecisions } from '../hq/HqReportDecisions'
import { useNow } from '@/hooks/use-now'
import { formatShortTimeAgo } from '@/lib/short-time-ago'

function HqPlusReportList({ onPick }: { onPick: (path: string) => void }): React.JSX.Element {
  const now = useNow(60_000)
  const { reports, error, loaded } = useHqReports()
  if (loaded && reports.length === 0) {
    return (
      <p className="hqp-empty">
        {error ?? translate('auto.hqPlus.report.none', 'No reports yet.')}
      </p>
    )
  }
  return (
    <ul className="hqp-report-list">
      {reports.map((report) => (
        <li key={report.path}>
          <button type="button" title={report.path} onClick={() => onPick(report.path)}>
            <span className="t">{report.title}</span>
            <span className="hqp-tm">
              {folderLabel(report.folder)} · {formatShortTimeAgo(report.at, now)}
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}

export function HqPlusReportView({
  path,
  onPick
}: {
  path: string | null
  onPick: (path: string | null) => void
}): React.JSX.Element {
  const page = useHqWikiPage(path)
  const { reports } = useHqReports()
  if (!path) {
    return <HqPlusReportList onPick={onPick} />
  }
  const report = reports.find((candidate) => candidate.path === path) ?? null
  return (
    <div className="hqp-report-view" data-open="true">
      <div className="hqp-fh">
        <button type="button" className="hqp-link" onClick={() => onPick(null)}>
          ← {translate('auto.hqPlus.report.all', 'All reports')}
        </button>
        <span className="hqp-mono">{path}</span>
        <span className="hqp-spacer" />
        <button
          type="button"
          className="hqp-chip-btn"
          onClick={() => {
            setHqFlavor('classic')
            requestHqReport(path)
            openHqScreen('reports')
          }}
        >
          {translate('auto.hqPlus.report.inReports', 'In Reports')}
        </button>
      </div>
      <div className="hqp-report-body">
        {page?.status === 'ready' ? (
          <CommentMarkdown
            variant="document"
            content={hqWikiBody(page.markdown)}
            className="text-sm"
          />
        ) : (
          <p className="hqp-empty">
            {page?.status === 'error'
              ? translate('auto.hq.wiki.pageFailed', "Couldn't read this page: {{value0}}", {
                  value0: page.message
                })
              : translate('auto.hq.wiki.loading', 'Loading…')}
          </p>
        )}
      </div>
      {report ? (
        <div className="hqp-report-ask">
          <HqReportDecisions key={report.path} report={report} />
        </div>
      ) : null}
    </div>
  )
}
