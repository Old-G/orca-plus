// Custom build (hq-plus-ui): a report's card in HQ+'s log — its first rows read from the file, and the
// moves that start work from it: an HQ chat on it, the proposals accepted, the Codex fixes run now.
import { useState } from 'react'
import { HqPlusText } from './HqPlusText'
import { HqPlusReplyField } from './HqPlusReplyField'
import type { HqPlusCard } from '../../../../../shared/hq-plus-log'
import { summarizeHqPlusReport } from '../../../../../shared/hq-plus-screen'
import { translate } from '@/i18n/i18n'
import { useHqWikiPage } from '../hq/use-hq-wiki-page'
import {
  hqPlusReportOf,
  isHqCodexReview,
  markHqPlusDone,
  runHqPlusCodexFix,
  sendHqPlusReport,
  type HqPlusResult
} from './hq-plus-actions'

export function HqPlusReportBody({
  card,
  busy,
  hqPath,
  hqWorktreeId,
  run,
  onOpenReport
}: {
  card: HqPlusCard
  busy: boolean
  hqPath: string | null
  hqWorktreeId: string | null
  run: (action: () => Promise<HqPlusResult>) => void
  onOpenReport: (path: string) => void
}): React.JSX.Element {
  const [text, setText] = useState('')
  const report = hqPlusReportOf(card)
  const page = useHqWikiPage(report?.path ?? null)
  const summary =
    page?.status === 'ready' && report ? summarizeHqPlusReport(page.markdown, report.path) : null
  const codex = report ? isHqCodexReview(report.path) : false
  const open = card.open
  const proposals = summary?.proposals ?? []

  return (
    <>
      <p className="hqp-q">
        <HqPlusText text={summary?.title ?? card.title} maxLines={2} />
      </p>
      {summary?.codex ? (
        <dl className="hqp-rep">
          <dt>P0/P1</dt>
          <dd>
            {translate('auto.hqPlus.report.codex', '{{serious}} serious · {{minor}} minor', {
              serious: summary.codex.serious,
              minor: summary.codex.minor
            })}
          </dd>
        </dl>
      ) : null}
      {summary && summary.rows.length > 0 ? (
        <ul className="hqp-text hqp-rows">
          {summary.rows.map((row) => (
            <li key={row}>{row}</li>
          ))}
        </ul>
      ) : null}
      {page?.status === 'error' ? <p className="hqp-error">{page.message}</p> : null}
      {open ? (
        <div className="hqp-opts">
          {codex ? (
            <>
              <button
                type="button"
                className="hqp-opt"
                data-main="true"
                disabled={busy}
                onClick={() => run(() => runHqPlusCodexFix(card, hqPath))}
              >
                {translate('auto.hqPlus.report.fixNow', 'Fix now')}
              </button>
              <button
                type="button"
                className="hqp-opt"
                disabled={busy}
                onClick={() => run(() => markHqPlusDone(card, 'wait-rule'))}
              >
                {translate('auto.hqPlus.report.waitRule', 'Wait for 19:00')}
              </button>
            </>
          ) : (
            <>
              {/* Custom build (hq-plus-stale): read and fine — the report leaves «waiting on you». */}
              <button
                type="button"
                className="hqp-opt"
                data-main="true"
                disabled={busy}
                title={translate('auto.hqPlus.report.doneHint', 'Read it, nothing to do')}
                onClick={() => run(() => markHqPlusDone(card, 'seen'))}
              >
                {translate('auto.hqPlus.report.done', 'Done')}
              </button>
              {proposals.length > 0 ? (
                <button
                  type="button"
                  className="hqp-opt"
                  disabled={busy || !hqWorktreeId}
                  onClick={() =>
                    run(() =>
                      sendHqPlusReport(
                        card,
                        proposals.map((number) => `${number} да`).join(', '),
                        hqWorktreeId,
                        'accept'
                      )
                    )
                  }
                >
                  {translate('auto.hqPlus.report.accept', 'Accept {{numbers}}', {
                    numbers: proposals.join(', ')
                  })}
                </button>
              ) : null}
            </>
          )}
          {report ? (
            <button
              type="button"
              className="hqp-opt"
              data-ghost="true"
              onClick={() => onOpenReport(report.path)}
            >
              {translate('auto.hqPlus.report.open', 'Open report')}
            </button>
          ) : null}
        </div>
      ) : report ? (
        <div className="hqp-opts">
          <button
            type="button"
            className="hqp-opt"
            data-ghost="true"
            onClick={() => onOpenReport(report.path)}
          >
            {translate('auto.hqPlus.report.open', 'Open report')}
          </button>
        </div>
      ) : null}
      {open && report ? (
        <form
          className="hqp-reply"
          onSubmit={(event) => {
            event.preventDefault()
            const words = text.trim()
            if (words) {
              run(() => sendHqPlusReport(card, words, hqWorktreeId, 'review'))
            }
          }}
        >
          <label className="hqp-sr" htmlFor={`hqp-rr-${card.id}`}>
            {translate('auto.hqPlus.report.replyLabel', 'Decisions on this report')}
          </label>
          <HqPlusReplyField
            id={`hqp-rr-${card.id}`}
            value={text}
            disabled={busy}
            placeholder={translate(
              'auto.hqPlus.report.replyHintChat',
              'Decide or ask — «1 да, 2 нет» or a question…'
            )}
            onChange={(event) => setText(event.target.value)}
          />
          <span className="hqp-to">
            → {translate('auto.hqPlus.report.toNewChat', 'new HQ chat')}
          </span>
          <button
            type="submit"
            className="hqp-go"
            disabled={busy || !text.trim() || !hqWorktreeId}
            aria-label={translate('auto.hqPlus.send', 'Send')}
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.6"
              aria-hidden="true"
            >
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          </button>
        </form>
      ) : null}
    </>
  )
}
