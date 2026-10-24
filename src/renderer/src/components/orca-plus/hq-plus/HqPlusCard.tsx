// Custom build (hq-plus-ui): one decision in HQ+'s log — the agent's question, a held message, a
// person's answer, a wait on the owner or a new report. Open while it waits; once decided it folds to
// two lines that say what was chosen, and opens again on a click.
import { useState } from 'react'
import {
  HQ_PLUS_DONE_HANDED_OFF,
  HQ_PLUS_DONE_IN_CHAT,
  HQ_PLUS_QUESTION_LINE,
  hqPlusChoices,
  type HqPlusCard as Card,
  type HqPlusDone
} from '../../../../../shared/hq-plus-log'
import { HQ_JOB_UNDO } from '../../../../../shared/hq-journal'
import { readPulseBellPaneRef } from '../../../../../shared/pulse-bell'
import { translate } from '@/i18n/i18n'
import { OutgoingApprovalDecision } from '../outgoing-approval/OutgoingApprovalCard'
import { runPulseBellAction } from '../pulse-bell/pulse-bell-actions'
import { PULSE_BELL_ACTION } from '../../../../../shared/pulse-bell'
import type { PulseInboxItem } from '../../../../../shared/pulse-types'
import {
  closeHqPlusWait,
  hqPlusReportOf,
  markHqPlusDone,
  sendHqPlusAgentDraft,
  settleHqPlusAgentDraft,
  replyOnHqPlusCard,
  replyOnHqPlusJob,
  tellHqPlusDraftingAgent,
  type HqPlusResult
} from './hq-plus-actions'
import { HqPlusReportBody } from './HqPlusReportBody'
import type { HqPlusLook } from '../../../../../shared/hq-plus-kinds'
import { readHqSlackRequestRef } from '../../../../../shared/hq-slack-request-bell'
import { HqPlusBadges } from './HqPlusBadge'
import { HqPlusText } from './HqPlusText'
import { HqPlusReplyField } from './HqPlusReplyField'
import { HQ_FIX_NOW_DONE_PREFIX } from '../../../../../shared/hq-fix-now'
import { useHqPlusDraftLink } from './use-hq-plus-draft-link'
import { hqPlusSourceLabel } from './hq-plus-source-label'
import type { HqPlusLinkClick } from './hq-plus-link-open'
import { HqPlusChatName, type HqPlusChatRef } from './HqPlusChatName'
import {
  HQ_WAITING_REPLY_ACTION,
  readHqWaitingReplyRef
} from '../../../../../shared/hq-waiting-reply-bell'

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
    if (done.status === HQ_PLUS_DONE_IN_CHAT) {
      return translate('auto.hqPlus.done.inChat', 'answered in the chat')
    }
    if (done.status === HQ_PLUS_DONE_HANDED_OFF) {
      return translate('auto.hqPlus.done.handedOff', 'a new chat took it over')
    }
    return done.status === 'dropped'
      ? translate('auto.hqPlus.done.dropped', 'dropped')
      : translate('auto.hqPlus.done.closed', 'closed')
  }
  // Custom build (hq-fix-now-all): «Fix now» keeps what it opened and what was already handled.
  if (done.action?.startsWith(HQ_FIX_NOW_DONE_PREFIX)) {
    return done.action.slice(HQ_FIX_NOW_DONE_PREFIX.length)
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
  if (card.job && card.report?.learned) {
    return card.report.learned
  }
  const lines = (card.body ?? '').split('\n').map((line) => line.replace(/\*\*/g, '').trim())
  const asked = lines.toReversed().find((line) => HQ_PLUS_QUESTION_LINE.test(line))
  return asked ?? card.title
}

// Custom build (hq-plus-ui-v2): a request offers the mockup's set — To work, Reply — and «Not now» below.
const INBOX_ACTION_LABEL: Readonly<Record<string, string>> = {
  'slack-do': 'To work',
  'intake-open': 'To work',
  'slack-answer': 'Reply',
  'slack-review': 'Investigate'
}

function inboxSourceUrl(refId: string | null): string | null {
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
  return typeof raw === 'string' ? raw : null
}

/**
 * Custom build (hq-plus-ui-v5): the Slack thread, ClickUp task or mail a card came from — an inbox
 * item's own link, its scout draft's message, else the first link its journal row keeps.
 */
function hqPlusSourceLink(
  card: Card,
  draftUrl: string | null
): { url: string; label: string } | null {
  const raw =
    inboxSourceUrl(card.inbox?.refId ?? null) ?? draftUrl ?? card.entry?.links[0]?.url ?? null
  if (!raw || !raw.startsWith('https://')) {
    return null
  }
  return { url: raw, label: hqPlusSourceLabel(raw) }
}

const TO_WORK_ACTIONS: ReadonlySet<string> = new Set(['slack-do', 'intake-open'])

type CardAction = { id: string; label: string; hint?: string }

/** Custom build (hq-plus-links): a person's answer says what each button does with it. */
function replyActions(card: Card, actions: readonly CardAction[]): CardAction[] {
  const author = readHqWaitingReplyRef(card.inbox?.refId ?? null)?.author ?? ''
  return actions.map((action) => {
    switch (action.id) {
      case HQ_WAITING_REPLY_ACTION.deliver:
        return {
          id: action.id,
          label: translate('auto.hqPlus.reply.deliver', 'Send answer to chat'),
          hint: translate(
            'auto.hqPlus.reply.deliverHint',
            'Sends {{author}}’s answer to the chat that asked, and the chat carries on with it',
            { author }
          )
        }
      case HQ_WAITING_REPLY_ACTION.open:
        return {
          ...action,
          hint: translate(
            'auto.hqPlus.reply.openHint',
            'Opens the chat that asked; the answer is not sent'
          )
        }
      case HQ_WAITING_REPLY_ACTION.skip:
        return {
          ...action,
          hint: translate('auto.hqPlus.reply.skipHint', 'Closes the answer; the chat never gets it')
        }
      default:
        return action
    }
  })
}

/** Buttons that open the card's chat, so the head needs no «Open» of its own. */
const OPEN_CHAT_ACTIONS: ReadonlySet<string> = new Set([
  HQ_WAITING_REPLY_ACTION.open,
  PULSE_BELL_ACTION.open
])

function inboxActions(card: Card, look: HqPlusLook): CardAction[] {
  const actions = card.inbox?.actions ?? []
  if (card.type === 'reply') {
    return replyActions(card, actions)
  }
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
  chat,
  onOpenChat,
  onOpenLink,
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
  /** Custom build (hq-plus-links): the card's chat, named as in the Chats list. */
  chat: HqPlusChatRef | null
  onOpenChat: (() => void) | null
  /** Custom build (hq-plus-round6): opens a link in HQ+'s Browser tab. */
  onOpenLink: (url: string, event?: HqPlusLinkClick) => void
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
  // Custom build (hq-plus-links): the pressed button, so a slow action (a new session) shows it works.
  const [pending, setPending] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [text, setText] = useState('')
  const open = card.open
  const reportPath = card.type === 'report' ? (hqPlusReportOf(card)?.path ?? null) : null
  const note = noteOf(card)
  const draftUrl = useHqPlusDraftLink(card.inbox?.refId ?? null)
  const sourceLink = hqPlusSourceLink(card, draftUrl)
  const actions =
    open && (card.type === 'reply' || card.type === 'bell') && card.inbox
      ? inboxActions(card, look)
      : []
  const rowOpensChat =
    open && (card.type === 'move' || actions.some((action) => OPEN_CHAT_ACTIONS.has(action.id)))
  const sourceInActions =
    open &&
    (card.type === 'wait' || ((card.type === 'reply' || card.type === 'bell') && !!card.inbox))
  const sourceButton = sourceLink ? (
    <button
      type="button"
      className="hqp-opt"
      data-ghost="true"
      onClick={(event) => onOpenLink(sourceLink.url, event)}
    >
      {sourceLink.label} ↗
    </button>
  ) : null
  const head = (
    <div className="hqp-row-h">
      <HqPlusBadges badges={look.badges} />
      {note ? <span className="hqp-note">{note}</span> : null}
      <strong>{card.job ?? card.project ?? 'HQ'}</strong>
      <HqPlusChatName chat={chat} />
      <span className="hqp-tm">{when}</span>
      {threadLabel && onThread ? (
        <button type="button" className="hqp-addr" onClick={onThread}>
          {threadLabel}
        </button>
      ) : null}
      <span className="hqp-spacer" />
      {/* Custom build (hq-plus-side-blocks): where the card came from — beside Done when the card has
          that row, else top-right on the head's line. */}
      {sourceLink && !sourceInActions ? (
        <button
          type="button"
          className="hqp-link hqp-source"
          onClick={(event) => onOpenLink(sourceLink.url, event)}
        >
          {sourceLink.label} ↗
        </button>
      ) : null}
      {onOpenChat && !rowOpensChat ? (
        <button type="button" className="hqp-pill" onClick={onOpenChat}>
          {translate('auto.hqPlus.open', 'Open')}
        </button>
      ) : null}
    </div>
  )
  const run = (action: () => Promise<HqPlusResult>, key: string | null = null): void => {
    if (busy) {
      return
    }
    setBusy(true)
    setPending(key)
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
      .finally(() => {
        setBusy(false)
        setPending(null)
      })
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
  const reply = (value: string): void =>
    run(() => (card.job ? replyOnHqPlusJob(card, value) : replyOnHqPlusCard(card, value, hqPath)))
  const canReply =
    card.type === 'move' &&
    Boolean(
      card.job ||
      card.address ||
      card.sessionId ||
      (card.inbox && readPulseBellPaneRef(card.inbox.refId))
    )

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
            {card.report?.done || card.report?.next || card.report?.found ? (
              <dl className="hqp-rep">
                {card.report.found ? (
                  <>
                    <dt>{translate('auto.hqPlus.found', 'found')}</dt>
                    <dd>{card.report.found}</dd>
                  </>
                ) : null}
                {card.report.done ? (
                  <>
                    <dt>
                      {card.job
                        ? translate('auto.hqPlus.did', 'did')
                        : translate('auto.hqPlus.done', 'done')}
                    </dt>
                    <dd>{card.report.done}</dd>
                  </>
                ) : null}
                {card.report.next ? (
                  <>
                    <dt>{translate('auto.hqPlus.next', 'next')}</dt>
                    <dd>{card.report.next}</dd>
                  </>
                ) : null}
                {card.report.learned && card.report.ask ? (
                  <>
                    <dt>{translate('auto.hqPlus.learned', 'learned')}</dt>
                    <dd>{card.report.learned}</dd>
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
            {card.type === 'approve' && open && !card.inbox ? (
              <>
                {card.body ? (
                  <p className="hqp-text">
                    <HqPlusText text={card.body} />
                  </p>
                ) : null}
                <div className="hqp-opts">
                  <button
                    type="button"
                    className="hqp-opt"
                    data-main="true"
                    disabled={busy || !hqWorktreeId}
                    title={translate(
                      'auto.hqPlus.agentDraft.sendHint',
                      'An HQ chat sends it; the message still waits for your Approve'
                    )}
                    onClick={() => run(() => sendHqPlusAgentDraft(card, hqWorktreeId))}
                  >
                    {translate('auto.hqPlus.agentDraft.send', 'Send via HQ')}
                  </button>
                  <button
                    type="button"
                    className="hqp-opt"
                    disabled={busy}
                    onClick={() => run(() => settleHqPlusAgentDraft(card, 'rejected'))}
                  >
                    {translate('auto.hqPlus.waitDrop', 'Not needed')}
                  </button>
                </div>
              </>
            ) : null}
            {card.type === 'approve' && !open && card.body ? (
              <p className="hqp-text">
                <HqPlusText text={card.body} />
              </p>
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
        {!open && !card.done && card.job && card.report?.learned ? (
          <div className="hqp-opts">
            <button
              type="button"
              className="hqp-opt"
              data-ghost="true"
              disabled={busy}
              title={translate(
                'auto.hqPlus.job.undoHint',
                'The job reads this on its next run and takes the rule back'
              )}
              onClick={() => reply(HQ_JOB_UNDO)}
            >
              {translate('auto.hqPlus.job.undo', 'Undo')}
            </button>
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
            {sourceButton}
          </div>
        ) : null}
        {open && (card.type === 'reply' || card.type === 'bell') && card.inbox ? (
          <div className="hqp-opts">
            {actions.map((action, index) => (
              <button
                key={action.id}
                type="button"
                className="hqp-opt"
                data-main={index === 0 ? 'true' : undefined}
                aria-busy={pending === action.id ? 'true' : undefined}
                disabled={busy}
                title={action.hint}
                onClick={() => {
                  const item = card.inbox
                  if (item && onToWork && TO_WORK_ACTIONS.has(action.id)) {
                    onToWork(item)
                  } else if (item) {
                    run(async () => {
                      await runPulseBellAction(item, action.id)
                      return { ok: true }
                    }, action.id)
                  }
                }}
              >
                {pending === action.id && action.id === PULSE_BELL_ACTION.launch
                  ? translate('auto.hqPlus.starting', 'Starting…')
                  : action.label}
              </button>
            ))}
            {/* Custom build (hq-plus-side-blocks): handled outside HQ+ already — Done closes the request. */}
            {look.kind === 'inbox' ? (
              <button
                type="button"
                className="hqp-opt"
                disabled={busy}
                onClick={() => run(() => markHqPlusDone(card, 'done'))}
              >
                {translate('auto.hqPlus.queue.done', 'Done')}
              </button>
            ) : null}
            {look.kind === 'inbox' && onNotNow ? (
              <button type="button" className="hqp-opt" data-ghost="true" onClick={onNotNow}>
                {translate('auto.hqPlus.notNow', 'Not now')}
              </button>
            ) : null}
            {sourceButton}
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
