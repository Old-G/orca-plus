// Custom build (hq-plus-ui): a report's card in HQ+'s log — its first rows read from the file, and the
// moves that start work from it: an HQ chat on it, the proposals accepted, the Codex fixes run now.
// Custom build (hq-plus-card-shell): drawn in the cards' one shell, with the decision card's head.
import { useState } from 'react'
import { HqPlusText } from './HqPlusText'
import { HqPlusComposer } from './HqPlusComposer'
import { HqPlusCardShell, useHqPlusRun, type HqPlusCardButton } from './HqPlusCardShell'
import type { HqPlusCard } from '../../../../../shared/hq-plus-log'
import { summarizeHqPlusReport } from '../../../../../shared/hq-plus-screen'
import { translate } from '@/i18n/i18n'
import { useHqWikiPage } from '../hq/use-hq-wiki-page'
import {
  hqPlusReportOf,
  isHqCodexReview,
  markHqPlusDone,
  runHqPlusCodexFix,
  sendHqPlusReport
} from './hq-plus-actions'

export function HqPlusReportCard({
  card,
  attributes,
  head,
  done,
  hqPath,
  hqWorktreeId,
  onOpenReport,
  onCollapse,
  onDone
}: {
  card: HqPlusCard
  /** The card's kind as data attributes, the same as every card's. */
  attributes: Record<`data-${string}`, string | undefined>
  head: React.ReactNode
  /** What became of the report, when it is decided. */
  done: string | null
  hqPath: string | null
  hqWorktreeId: string | null
  onOpenReport: (path: string) => void
  onCollapse: (() => void) | null
  onDone: () => void
}): React.JSX.Element {
  const [text, setText] = useState('')
  const { busy, error, run } = useHqPlusRun(() => {
    setText('')
    onDone()
  })
  const report = hqPlusReportOf(card)
  const page = useHqWikiPage(report?.path ?? null)
  const summary =
    page?.status === 'ready' && report ? summarizeHqPlusReport(page.markdown, report.path) : null
  const codex = report ? isHqCodexReview(report.path) : false
  const open = card.open
  const proposals = summary?.proposals ?? []
  const openReport: HqPlusCardButton[] = report
    ? [
        {
          id: 'open-report',
          label: translate('auto.hqPlus.report.open', 'Open report'),
          ghost: true,
          onClick: () => onOpenReport(report.path)
        }
      ]
    : []
  const decide: HqPlusCardButton[] = !open
    ? []
    : codex
      ? [
          {
            id: 'fix-now',
            label: translate('auto.hqPlus.report.fixNow', 'Fix now'),
            main: true,
            disabled: busy,
            onClick: () => run(() => runHqPlusCodexFix(card, hqPath))
          },
          {
            id: 'wait-rule',
            label: translate('auto.hqPlus.report.waitRule', 'Wait for 19:00'),
            disabled: busy,
            onClick: () => run(() => markHqPlusDone(card, 'wait-rule'))
          }
        ]
      : [
          // Custom build (hq-plus-stale): read and fine — the report leaves «waiting on you».
          {
            id: 'seen',
            label: translate('auto.hqPlus.report.done', 'Done'),
            hint: translate('auto.hqPlus.report.doneHint', 'Read it, nothing to do'),
            main: true,
            disabled: busy,
            onClick: () => run(() => markHqPlusDone(card, 'seen'))
          },
          ...(proposals.length > 0
            ? [
                {
                  id: 'accept',
                  label: translate('auto.hqPlus.report.accept', 'Accept {{numbers}}', {
                    numbers: proposals.join(', ')
                  }),
                  disabled: busy || !hqWorktreeId,
                  onClick: () =>
                    run(() =>
                      sendHqPlusReport(
                        card,
                        proposals.map((number) => `${number} да`).join(', '),
                        hqWorktreeId,
                        'accept'
                      )
                    )
                }
              ]
            : [])
        ]

  return (
    <HqPlusCardShell
      {...attributes}
      head={head}
      done={done}
      buttons={[...decide, ...openReport]}
      composer={
        open && report ? (
          <HqPlusComposer
            id={`hqp-rr-${card.id}`}
            label={translate('auto.hqPlus.report.replyLabel', 'Decisions on this report')}
            value={text}
            busy={busy}
            canSend={Boolean(hqWorktreeId)}
            placeholder={translate(
              'auto.hqPlus.report.replyHintChat',
              'Decide or ask — «1 да, 2 нет» or a question…'
            )}
            to={translate('auto.hqPlus.report.toNewChat', 'new HQ chat')}
            sendLabel={translate('auto.hqPlus.send', 'Send')}
            onChange={setText}
            onSubmit={() => run(() => sendHqPlusReport(card, text.trim(), hqWorktreeId, 'review'))}
          />
        ) : null
      }
      error={error}
      footer={{ onCollapse }}
    >
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
    </HqPlusCardShell>
  )
}
