// Custom build (hq-plus-ui): a report read inside HQ+'s right panel, with the same markdown Reports uses;
// «In Reports» opens it in classic HQ, where every report stays listed.
import CommentMarkdown from '@/components/sidebar/CommentMarkdown'
import { translate } from '@/i18n/i18n'
import { hqWikiBody } from '../hq/hq-wiki-tree'
import { requestHqReport } from '../hq/hq-report-target'
import { openHqScreen } from '../hq/hq-view'
import { useHqWikiPage } from '../hq/use-hq-wiki-page'
import { setHqFlavor } from './hq-plus-flavor'

export function HqPlusReportView({ path }: { path: string | null }): React.JSX.Element {
  const page = useHqWikiPage(path)
  if (!path) {
    return (
      <p className="hqp-empty">
        {translate('auto.hqPlus.report.pick', 'Open a report from its card in the log.')}
      </p>
    )
  }
  return (
    <div className="hqp-report-view">
      <div className="hqp-fh">
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
      {page?.status === 'ready' ? (
        <CommentMarkdown variant="document" content={hqWikiBody(page.markdown)} className="text-sm" />
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
  )
}
