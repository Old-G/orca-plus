// Custom build (hq-plus-ui): one decision in HQ+'s log — the agent's question, a held message, a
// person's answer, a wait on the owner or a new report. Open while it waits; once decided it folds to
// two lines that say what was chosen, and opens again on a click.
import { useState } from 'react'
import {
  hqPlusChoices,
  type HqPlusCard as Card,
  type HqPlusDone
} from '../../../../../shared/hq-plus-log'
import { translate } from '@/i18n/i18n'
import { OutgoingApprovalDecision } from '../outgoing-approval/OutgoingApprovalCard'
import { runPulseBellAction } from '../pulse-bell/pulse-bell-actions'
import { PULSE_BELL_ACTION } from '../../../../../shared/pulse-bell'
import type { PulseInboxItem } from '../../../../../shared/pulse-types'
import {
  closeHqPlusWait,
  hqPlusReportOf,
  markHqPlusDone,
  replyOnHqPlusCard,
  tellHqPlusDraftingAgent,
  type HqPlusResult
} from './hq-plus-actions'
import { HqPlusReportBody } from './HqPlusReportBody'
import type { HqPlusLook } from '../../../../../shared/hq-plus-kinds'
import { readHqSlackRequestRef } from '../../../../../shared/hq-slack-request-bell'
import { hqSourceService } from '../../../../../shared/hq-source-link'
import { HqPlusBadges } from './HqPlusBadge'
import { HqPlusText } from './HqPlusText'
import { HqPlusReplyField } from './HqPlusReplyField'

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

const BELL_LABEL: Record<string, string> = {
  'slack-request': 'Slack request',
  'hq-intake': 'to work, from Slack',
  'claude-chat-limit': 'Claude limit',
  'claude-auth-stop': 'Claude sign-in',
  handoff: 'handoff ready'
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
    if (done.status === 'not-now') {
      return translate('auto.hqPlus.done.notNow', 'not now · back tomorrow')
    }
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

// Custom build (hq-plus-ui-v2): a request offers the mockup's set — To work, Reply — and «Not now» below.
const INBOX_ACTION_LABEL: Readonly<Record<string, string>> = {
  'slack-do': 'To work',
  'intake-open': 'To work',
  'slack-answer': 'Reply',
  'slack-review': 'Investigate'
}

/** Custom build (hq-plus-ui-v5): the Slack thread, ClickUp task or mail an inbox card came from. */
function hqPlusSourceLink(refId: string | null): { url: string; label: string } | null {
  let parsed: unknown = null
  try {
    parsed = refId ? JSON.parse(refId) : null
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') {
    return null
  }
  const raw: unknown = Reflect.get(parsed, 'link') ?? Reflect.get(parsed, 'permalink')
  if (typeof raw !== 'string' || !/^https:\/\//.test(raw)) {
    return null
  }
  const service = hqSourceService(raw)
  const label =
    service === 'slack'
      ? translate('auto.hqPlus.source.slack', 'Open in Slack')
      : service === 'clickup'
        ? translate('auto.hqPlus.source.clickup', 'Open in ClickUp')
        : service === 'gmail'
          ? translate('auto.hqPlus.source.gmail', 'Open in Gmail')
          : service === 'gitlab'
            ? translate('auto.hqPlus.source.gitlab', 'Open in GitLab')
            : translate('auto.hqPlus.source.other', 'Open external site')
  return { url: raw, label }
}

const TO_WORK_ACTIONS: ReadonlySet<string> = new Set(['slack-do', 'intake-open'])

function inboxActions(card: Card, look: HqPlusLook): { id: string; label: string }[] {
  const actions = card.inbox?.actions ?? []
  if (look.kind !== 'inbox') {
    return actions
  }
  const picked = actions.flatMap((action) => {
    const label = INBOX_ACTION_LABEL[action.id]
    return label
      ? [{ id: action.id, label: translate(`auto.hqPlus.inbox.${action.id}`, label) }]
      : []
  })
  return picked.length > 0 ? picked : actions
}

/** A word beside the badges: which report, what the person wants from the owner. */
function noteOf(card: Card): string | null {
  if (card.type === 'report') {
    return hqPlusReportOf(card)?.folder ?? null
  }
  if (card.type !== 'bell') {
    return null
  }
  const ask = readHqSlackRequestRef(card.inbox?.refId ?? null)?.kind
  if (ask === 'answer') {
    return translate('auto.hqPlus.ask.answer', 'wants your answer')
  }
  if (ask === 'do') {
    return translate('auto.hqPlus.ask.do', 'asks you to do it')
  }
  return BELL_LABEL[card.inbox?.kind ?? ''] ?? null
}

export function HqPlusCardView({
  card,
  look,
  flash,
  hqPath,
  hqWorktreeId,
  when,
  threadLabel,
  onThread,
  onOpenChat,
  onOpenReport,
  onNotNow,
  onChanged,
  expanded,
  onExpand,
  onToWork
}: {
  card: Card
  look: HqPlusLook
  flash: boolean
  hqPath: string | null
  hqWorktreeId: string | null
  when: string
  threadLabel: string | null
  onThread: (() => void) | null
  onOpenChat: (() => void) | null
  onOpenReport: (path: string) => void
  onNotNow: (() => void) | null
  onChanged: () => void
  /** Custom build (hq-plus-ui-v4): a decided card unfolded; kept by the feed so keys can fold it too. */
  expanded: boolean
  onExpand: (open: boolean) => void
  /** Custom build (hq-plus-ui-v5): «To work» opens the project and chat picker on the right. */
  onToWork: ((item: PulseInboxItem) => void) | null
}): React.JSX.Element {
  const setExpanded = onExpand
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [text, setText] = useState('')
  const open = card.open
  const reportPath = card.type === 'report' ? (hqPlusReportOf(card)?.path ?? null) : null
  const note = noteOf(card)
  const head = (
    <div className="hqp-row-h">
      <HqPlusBadges badges={look.badges} />
      {note ? <span className="hqp-note">{note}</span> : null}
      <strong>{card.project ?? 'HQ'}</strong>
      <span className="hqp-tm">{when}</span>
      {threadLabel && onThread ? (
        <button type="button" className="hqp-addr" onClick={onThread}>
          {threadLabel}
        </button>
      ) : null}
      <span className="hqp-spacer" />
      {onOpenChat && !(open && card.type === 'move') ? (
        <button type="button" className="hqp-pill" onClick={onOpenChat}>
          {translate('auto.hqPlus.open', 'Open')}
        </button>
      ) : null}
    </div>
  )
  const run = (action: () => Promise<HqPlusResult>): void => {
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

  // Custom build (hq-plus-ui-v5): a request waits folded — who and one line; a click unfolds it.
  if (open && look.kind === 'inbox' && !expanded) {
    return (
      <div
        className="hqp-card"
        data-type={card.type}
        data-look={look.kind}
        data-source={look.source ?? undefined}
        data-flash={flash ? 'true' : undefined}
      >
        {head}
        <button
          type="button"
          className="hqp-cc"
          aria-expanded="false"
          onClick={() => setExpanded(true)}
        >
          <span className="l1">
            <HqPlusText text={questionOf(card)} maxLines={1} />
          </span>
        </button>
      </div>
    )
  }

  if (!open && !expanded && card.done) {
    return (
      <div
        className="hqp-card"
        data-type={card.type}
        data-look={look.kind}
        data-source={look.source ?? undefined}
        data-flash={flash ? 'true' : undefined}
      >
        {head}
        <button
          type="button"
          className="hqp-cc"
          aria-expanded="false"
          onClick={() => setExpanded(true)}
        >
          <span className="l1">
            <HqPlusText text={card.type === 'move' ? questionOf(card) : card.title} maxLines={1} />
          </span>
          <span className="l2">✓ {hqPlusDoneLabel(card.done)}</span>
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
  const sourceLink = hqPlusSourceLink(card.inbox?.refId ?? null)

  return (
    <div
      className="hqp-card"
      data-type={card.type}
      data-look={look.kind}
      data-source={look.source ?? undefined}
      data-open={open ? 'true' : undefined}
      data-flash={flash ? 'true' : undefined}
    >
      <div className="hqp-cb">
        {head}
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
            {card.type === 'approve' ? null : (
              <p className="hqp-q">
                <HqPlusText text={questionOf(card)} />
              </p>
            )}
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
              <p className="hqp-text">
                <HqPlusText text={card.body} />
              </p>
            ) : null}
            {card.type === 'approve' && open && card.inbox ? (
              <div className="hqp-approve-host">
                <OutgoingApprovalDecision item={card.inbox} />
              </div>
            ) : null}
            {card.type === 'approve' && !open && card.body ? (
              <p className="hqp-text">
                <HqPlusText text={card.body} />
              </p>
            ) : null}
          </>
        )}
        {look.kind === 'inbox' && sourceLink ? (
          <button
            type="button"
            className="hqp-link hqp-source"
            onClick={() => void window.api.shell.openUrl(sourceLink.url)}
          >
            {sourceLink.label} ↗
          </button>
        ) : null}
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
            ) : card.inbox ? (
              <button
                type="button"
                className="hqp-opt"
                onClick={() => {
                  const item = card.inbox
                  if (item) {
                    void runPulseBellAction(item, PULSE_BELL_ACTION.open)
                  }
                }}
              >
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
        {open && (card.type === 'reply' || card.type === 'bell') && card.inbox ? (
          <div className="hqp-opts">
            {inboxActions(card, look).map((action, index) => (
              <button
                key={action.id}
                type="button"
                className="hqp-opt"
                data-main={index === 0 ? 'true' : undefined}
                disabled={busy}
                onClick={() => {
                  const item = card.inbox
                  if (item && onToWork && TO_WORK_ACTIONS.has(action.id)) {
                    onToWork(item)
                  } else if (item) {
                    run(async () => {
                      await runPulseBellAction(item, action.id)
                      return { ok: true }
                    })
                  }
                }}
              >
                {action.label}
              </button>
            ))}
            {look.kind === 'inbox' && onNotNow ? (
              <button type="button" className="hqp-opt" data-ghost="true" onClick={onNotNow}>
                {translate('auto.hqPlus.notNow', 'Not now')}
              </button>
            ) : null}
          </div>
        ) : null}
        {open && card.type === 'approve' && card.inbox ? (
          <form
            className="hqp-reply"
            onSubmit={(event) => {
              event.preventDefault()
              run(() => tellHqPlusDraftingAgent(card, text))
            }}
          >
            <label className="hqp-sr" htmlFor={`hqp-t-${card.id}`}>
              {translate('auto.hqPlus.tellAgent', 'Tell agent')}
            </label>
            <HqPlusReplyField
              id={`hqp-t-${card.id}`}
              value={text}
              disabled={busy}
              placeholder={translate(
                'auto.hqPlus.tellAgentHint',
                'Tell agent: make it shorter, add a deadline…'
              )}
              onChange={(event) => setText(event.target.value)}
            />
            <span className="hqp-to">
              → {translate('auto.hqPlus.tellAgentTo', 'agent, not sent')}
            </span>
            <button
              type="submit"
              className="hqp-go"
              disabled={busy || !text.trim()}
              aria-label={translate('auto.hqPlus.tellAgent', 'Tell agent')}
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
        {open &&
        onNotNow &&
        look.kind !== 'inbox' &&
        (card.type === 'approve' || card.type === 'bell') ? (
          <div className="hqp-opts">
            <button type="button" className="hqp-opt" data-ghost="true" onClick={onNotNow}>
              {translate('auto.hqPlus.notNow', 'Not now')}
            </button>
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
            <HqPlusReplyField
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
        {error ? <p className="hqp-error">{error}</p> : null}
        {expanded && (!open || look.kind === 'inbox') ? (
          <div className="hqp-row-f">
            <span className="hqp-spacer" />
            <button type="button" className="hqp-pill" onClick={() => setExpanded(false)}>
              {translate('auto.hqPlus.collapseCard', 'Collapse')}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  )
}
