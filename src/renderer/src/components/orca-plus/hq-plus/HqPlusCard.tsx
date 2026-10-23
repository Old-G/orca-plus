// Custom build (hq-plus-ui): one decision in HQ+'s log — the agent's question, a held message, a
// person's answer, a wait on the owner or a new report. Open while it waits; once decided it folds to
// two lines that say what was chosen, and opens again on a click.
import { useState } from 'react'
import { hqPlusChoices, type HqPlusCard as Card, type HqPlusDone } from '../../../../../shared/hq-plus-log'
import { readHqWaitingReplyRef } from '../../../../../shared/hq-waiting-reply-bell'
import { translate } from '@/i18n/i18n'
import { OutgoingApprovalDecision } from '../outgoing-approval/OutgoingApprovalCard'
import { runHqWaitingReplyAction } from '../pulse-bell/hq-waiting-reply-actions'
import {
  closeHqPlusWait,
  hqPlusReportOf,
  markHqPlusDone,
  replyOnHqPlusCard,
  type HqPlusResult
} from './hq-plus-actions'
import { HqPlusReportBody } from './HqPlusReportBody'

const DONE_ACTION: Record<string, [string, string]> = {
  open: ['auto.hqPlus.done.open', 'opened'],
  dismiss: ['auto.hqPlus.done.dismiss', 'not now'],
  seen: ['auto.hqPlus.done.seen', 'got it'],
  'fix-now': ['auto.hqPlus.done.fixNow', 'fixing chats opened'],
  'wait-rule': ['auto.hqPlus.done.waitRule', 'left to the evening rule'],
  review: ['auto.hqPlus.done.review', 'handed to an HQ chat'],
  accept: ['auto.hqPlus.done.accept', 'proposals accepted'],
  approve: ['auto.hqPlus.done.approve', 'sent'],
  reject: ['auto.hqPlus.done.reject', 'rejected'],
  edit: ['auto.hqPlus.done.edit', 'edited and sent']
}

function clock(at: number | null): string {
  return at ? new Date(at).toTimeString().slice(0, 5) : ''
}

export function hqPlusDoneLabel(done: HqPlusDone): string {
  if (done.by === 'reply') {
    return translate('auto.hqPlus.done.reply', 'you: «{{text}}» · {{at}}', {
      text: done.text.length > 80 ? `${done.text.slice(0, 78)}…` : done.text,
      at: clock(done.at)
    })
  }
  if (done.by === 'status') {
    if (done.status === 'superseded') {
      return translate('auto.hqPlus.done.superseded', 'a newer report came')
    }
    return done.status === 'dropped'
      ? translate('auto.hqPlus.done.dropped', 'dropped')
      : translate('auto.hqPlus.done.closed', 'closed')
  }
  const known = done.action ? DONE_ACTION[done.action] : undefined
  const label = known
    ? translate(known[0], known[1])
    : translate('auto.hqPlus.done.decided', 'decided')
  return done.at ? `${label} · ${clock(done.at)}` : label
}

/** The question a turn ends on, else its title. */
function questionOf(card: Card): string {
  if (card.report?.ask) {
    return card.report.ask
  }
  const lines = (card.body ?? '').split('\n').map((line) => line.replace(/\*\*/g, '').trim())
  const asked = lines.toReversed().find((line) => line.endsWith('?'))
  return asked ?? card.title
}

function labelOf(card: Card): string {
  switch (card.type) {
    case 'approve':
      return translate('auto.hqPlus.label.approve', 'approve')
    case 'reply':
      return translate('auto.hqPlus.label.reply', 'a person answered')
    case 'wait':
      return translate('auto.hqPlus.label.wait', 'waits on you')
    case 'report':
      return translate('auto.hqPlus.label.report', 'report · {{kind}}', {
        kind: hqPlusReportOf(card)?.folder ?? 'updates'
      })
    case 'move':
      return translate('auto.hqPlus.label.move', 'your word')
  }
}

export function HqPlusCardView({
  card,
  flash,
  hqPath,
  hqWorktreeId,
  onOpenChat,
  onOpenReport,
  onChanged
}: {
  card: Card
  flash: boolean
  hqPath: string | null
  hqWorktreeId: string | null
  onOpenChat: (() => void) | null
  onOpenReport: (path: string) => void
  onChanged: () => void
}): React.JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [text, setText] = useState('')
  const open = card.open
  const reportPath = card.type === 'report' ? (hqPlusReportOf(card)?.path ?? null) : null
  const run =(action: () => Promise<HqPlusResult>): void => {
    if (busy) {
      return
    }
    setBusy(true)
    setError(null)
    void action()
      .then((result) => {
        if (result.ok) {
          setText('')
          setExpanded(false)
          onChanged()
        } else {
          setError(result.message)
        }
      })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => setBusy(false))
  }

  if (!open && !expanded && card.done) {
    return (
      <div className="hqp-card" data-type={card.type} data-flash={flash ? 'true' : undefined}>
        <button
          type="button"
          className="hqp-cc"
          aria-expanded="false"
          onClick={() => setExpanded(true)}
        >
          <span className="l1">{card.type === 'move' ? questionOf(card) : card.title}</span>
          <span className="l2">✓ {hqPlusDoneLabel(card.done)}</span>
          <span className="ex">{translate('auto.hqPlus.expand', 'expand')}</span>
        </button>
        {reportPath ? (
          <button type="button" className="hqp-cc-open" onClick={() => onOpenReport(reportPath)}>
            {translate('auto.hqPlus.report.openShort', 'open')}
          </button>
        ) : null}
      </div>
    )
  }

  const choices = card.report?.options.length ? card.report.options : hqPlusChoices(card.body)
  const reply = (value: string): void => run(() => replyOnHqPlusCard(card, value, hqPath))
  const canReply = card.type === 'move' && Boolean(card.address || card.sessionId)

  return (
    <div
      className="hqp-card"
      data-type={card.type}
      data-open={open ? 'true' : undefined}
      data-flash={flash ? 'true' : undefined}
    >
      <div className="hqp-cb">
        <span className="hqp-lab">{labelOf(card)}</span>
        {card.type === 'report' ? (
          <HqPlusReportBody
            card={card}
            busy={busy}
            hqPath={hqPath}
            hqWorktreeId={hqWorktreeId}
            run={run}
            onOpenReport={onOpenReport}
          />
        ) : (
          <>
            {card.type === 'approve' ? null : <p className="hqp-q">{questionOf(card)}</p>}
            {card.report?.done || card.report?.next ? (
              <dl className="hqp-rep">
                {card.report.done ? (
                  <>
                    <dt>{translate('auto.hqPlus.done', 'done')}</dt>
                    <dd>{card.report.done}</dd>
                  </>
                ) : null}
                {card.report.next ? (
                  <>
                    <dt>{translate('auto.hqPlus.next', 'next')}</dt>
                    <dd>{card.report.next}</dd>
                  </>
                ) : null}
              </dl>
            ) : card.body && card.type !== 'approve' ? (
              <p className="hqp-text">{card.body}</p>
            ) : null}
            {card.type === 'approve' && open && card.inbox ? (
              <div className="hqp-approve-host">
                <OutgoingApprovalDecision item={card.inbox} />
              </div>
            ) : null}
            {card.type === 'approve' && !open && card.body ? (
              <p className="hqp-text">{card.body}</p>
            ) : null}
          </>
        )}
        {card.done ? (
          <dl className="hqp-rep">
            <dt>{translate('auto.hqPlus.decided', 'decided')}</dt>
            <dd>{hqPlusDoneLabel(card.done)}</dd>
          </dl>
        ) : null}
        {open && card.type === 'move' ? (
          <div className="hqp-opts">
            {choices.map((choice, index) => (
              <button
                key={choice}
                type="button"
                className="hqp-opt"
                data-main={index === 0 ? 'true' : undefined}
                disabled={busy || !canReply}
                onClick={() => reply(choice)}
              >
                {choice} <kbd>{index + 1}</kbd>
              </button>
            ))}
            {onOpenChat ? (
              <button type="button" className="hqp-opt" onClick={onOpenChat}>
                {translate('auto.hqPlus.openChat', 'Open chat')}
              </button>
            ) : null}
            {card.inbox ? (
              <button
                type="button"
                className="hqp-opt"
                data-ghost="true"
                disabled={busy}
                onClick={() => run(() => markHqPlusDone(card, 'seen'))}
              >
                {translate('auto.hqPlus.gotIt', 'Got it')}
              </button>
            ) : null}
          </div>
        ) : null}
        {open && card.type === 'wait' ? (
          <div className="hqp-opts">
            <button
              type="button"
              className="hqp-opt"
              data-main="true"
              disabled={busy}
              onClick={() => run(() => closeHqPlusWait(card, 'resolved'))}
            >
              {translate('auto.hqPlus.waitDone', 'Done')}
            </button>
            <button
              type="button"
              className="hqp-opt"
              disabled={busy}
              onClick={() => run(() => closeHqPlusWait(card, 'cancelled'))}
            >
              {translate('auto.hqPlus.waitDrop', 'Not needed')}
            </button>
          </div>
        ) : null}
        {open && card.type === 'reply' && card.inbox ? (
          <div className="hqp-opts">
            {card.inbox.actions.map((action, index) => {
              const ref = readHqWaitingReplyRef(card.inbox?.refId ?? null)
              return (
                <button
                  key={action.id}
                  type="button"
                  className="hqp-opt"
                  data-main={index === 0 ? 'true' : undefined}
                  disabled={busy || !ref}
                  onClick={() =>
                    run(async () => {
                      if (ref) {
                        await runHqWaitingReplyAction(ref, action.id)
                      }
                      return { ok: true }
                    })
                  }
                >
                  {action.label}
                </button>
              )
            })}
          </div>
        ) : null}
        {open && canReply ? (
          <form
            className="hqp-reply"
            onSubmit={(event) => {
              event.preventDefault()
              reply(text)
            }}
          >
            <label className="hqp-sr" htmlFor={`hqp-r-${card.id}`}>
              {translate('auto.hqPlus.replyLabel', 'Answer this chat')}
            </label>
            <input
              id={`hqp-r-${card.id}`}
              value={text}
              disabled={busy}
              placeholder={translate('auto.hqPlus.replyHint', 'Answer, or add to a button…')}
              onChange={(event) => setText(event.target.value)}
            />
            <span className="hqp-to">→ {card.address ?? card.project ?? ''}</span>
            <button
              type="submit"
              className="hqp-go"
              disabled={busy || !text.trim()}
              aria-label={translate('auto.hqPlus.send', 'Send')}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" aria-hidden="true">
                <path d="M5 12h14M13 6l6 6-6 6" />
              </svg>
            </button>
          </form>
        ) : null}
        {error ? <p className="hqp-error">{error}</p> : null}
        {!open && expanded ? (
          <button
            type="button"
            className="hqp-opt"
            data-ghost="true"
            onClick={() => setExpanded(false)}
          >
            {translate('auto.hqPlus.collapse', 'collapse')}
          </button>
        ) : null}
      </div>
    </div>
  )
}
