// Custom build (hq-notes): one line of HQ → Notes — what is awaited, from whom, in which chat, and
// (hq-waiting-replies) the person's answer once the Slack scout found it.
import { useState } from 'react'
import { ExternalLink, MessagesSquare } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { translate } from '@/i18n/i18n'
import { formatShortTimeAgo } from '@/lib/short-time-ago'
import { HQ_NOTE_SOURCE } from '../../../../../shared/hq-note-parse'
import type { HqWaiting } from '../../../../../shared/hq-pulse-snapshot'
import { clickUpWaitingUrl, slackThreadUrl } from '../../../../../shared/hq-waiting-replies'
import { useAppStore } from '@/store'
import { structuredAgentSessionTabId } from '../../../../../shared/structured-agent-session-projection'
import type { HqChatItem } from './hq-chat-list'
import { openHqHistoryEntry } from './hq-history-open'
import { useHqChatTitle } from './HqChatAvatar'
import { RemindButton } from './HqTodayPeople'
import { errorText } from './hq-waiting-parts'
import { closeHqWaiting } from './use-hq-pulse'
import { hqSpaceStripeStyle } from './use-hq-spaces'

// Why: a day without an answer is when a nudge stops being pushy.
const REMIND_AFTER_MS = 24 * 60 * 60_000

function ChatName({ item }: { item: HqChatItem }): React.JSX.Element {
  return <>{useHqChatTitle(item)}</>
}

export function noteInitials(text: string): string {
  return (
    text
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim()
      .slice(0, 2)
      .toUpperCase() || '··'
  )
}

export function noteDueLabel(dueAt: number): string {
  return new Date(dueAt).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'numeric'
  })
}

function deliveryLabel(reply: NonNullable<HqWaiting['reply']>, toChat: boolean): string {
  if (reply.deliveredAt !== null) {
    return translate('auto.hq.notes.replyDelivered', 'Sent to the chat')
  }
  return toChat
    ? translate('auto.hq.notes.replyPending', 'Reaches the chat once it is open')
    : translate('auto.hq.notes.replyHereOnly', 'Only here — no chat to send it to')
}

function ReplyBlock({
  reply,
  toChat,
  now
}: {
  reply: NonNullable<HqWaiting['reply']>
  /** A native chat waits and will get the answer. */
  toChat: boolean
  now: number
}): React.JSX.Element {
  return (
    <span className="mt-1 block rounded-md border border-status-success-border bg-status-success-background px-2 py-1.5">
      <span className="flex items-baseline gap-2 text-2xs text-muted-foreground">
        <span className="font-semibold text-status-success">
          {reply.author ?? translate('auto.hq.notes.replyAuthorless', 'Answer')}
        </span>
        <span>{formatShortTimeAgo(reply.at, now)}</span>
        <span
          data-delivered={reply.deliveredAt !== null}
          className="ml-auto data-[delivered=false]:text-status-warning"
        >
          {deliveryLabel(reply, toChat)}
        </span>
      </span>
      <span className="line-clamp-4 block text-[13px] whitespace-pre-wrap">{reply.text}</span>
    </span>
  )
}

export function HqNoteRow({
  waiting,
  personName,
  chat,
  now,
  hqWorktreeId,
  showPerson = true,
  stripe = null
}: {
  waiting: HqWaiting
  /** Custom build (hq-spaces): the workspace's colour while all are shown. */
  stripe?: string | null
  personName: string | null
  /** False inside a person's card, whose header already names them. */
  showPerson?: boolean
  /** The chat that waits, while it is in the chat list. */
  chat: HqChatItem | null
  now: number
  hqWorktreeId: string | null
}): React.JSX.Element {
  const [busy, setBusy] = useState(false)
  const clickUpWorkspaceId = useAppStore((s) => s.clickUpStatus.selectedWorkspaceId)
  const [error, setError] = useState<string | null>(null)
  const close = (status: 'resolved' | 'cancelled'): void => {
    setBusy(true)
    setError(null)
    // Why: on success the snapshot refresh removes the row, so busy stays set until then.
    closeHqWaiting(waiting.id, status).catch((reason: unknown) => {
      setError(errorText(reason))
      setBusy(false)
    })
  }
  const isNote = waiting.source === HQ_NOTE_SOURCE
  const who = showPerson
    ? (personName ?? (isNote ? translate('auto.hq.notes.self', 'Me') : null))
    : null
  const project = chat?.projectName ?? waiting.project
  const canRemind =
    waiting.direction === 'on-them' &&
    !isNote &&
    !waiting.reply &&
    now - waiting.createdAt > REMIND_AFTER_MS
  const slackUrl = slackThreadUrl(waiting.sourceRef)
  // Custom build (hq-clickup-waiting): a question asked in a task opens there.
  const clickUpUrl = clickUpWaitingUrl(waiting.sourceRef, clickUpWorkspaceId)
  const { agentSessionId, worktreeId } = waiting
  return (
    <li
      style={hqSpaceStripeStyle(stripe)}
      className="flex items-start gap-2.5 px-3 py-2.5 hover:bg-accent/50"
    >
      <Checkbox
        className="mt-1"
        disabled={busy}
        onCheckedChange={() => close('resolved')}
        aria-label={translate('auto.hq.waiting.done', 'Done')}
      />
      <span className="min-w-0 flex-1">
        <span className="block text-sm">{waiting.title}</span>
        <span className="mt-0.5 flex items-baseline gap-2 text-xs text-muted-foreground">
          <span className="min-w-0 truncate">
            {who ? `${who} · ` : null}
            {chat ? (
              <>
                <ChatName item={chat} />
                {' · '}
              </>
            ) : null}
            {project ? `${project} · ` : null}
            {formatShortTimeAgo(waiting.createdAt, now)}
          </span>
          {waiting.dueAt !== null ? (
            <span
              data-overdue={waiting.dueAt < now}
              className="shrink-0 data-[overdue=true]:text-destructive"
            >
              {translate('auto.hq.waiting.due', 'due {{value0}}', {
                value0: noteDueLabel(waiting.dueAt)
              })}
            </span>
          ) : null}
        </span>
        {waiting.reply ? (
          <ReplyBlock reply={waiting.reply} toChat={Boolean(waiting.agentSessionId)} now={now} />
        ) : null}
        {error ? <span className="block text-xs text-destructive">{error}</span> : null}
      </span>
      <span className="flex shrink-0 items-center gap-0.5">
        {agentSessionId && worktreeId ? (
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            title={translate('auto.hq.notes.openChat', 'Open the chat that waits')}
            aria-label={translate('auto.hq.notes.openChat', 'Open the chat that waits')}
            onClick={() =>
              void openHqHistoryEntry({
                worktreeId,
                tabId: structuredAgentSessionTabId(agentSessionId),
                sessionId: agentSessionId
              })
            }
          >
            <MessagesSquare />
          </Button>
        ) : null}
        {slackUrl ? (
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            title={translate('auto.hq.notes.openSlack', 'Open in Slack')}
            aria-label={translate('auto.hq.notes.openSlack', 'Open in Slack')}
            onClick={() => void window.api.shell.openUrl(slackUrl)}
          >
            <ExternalLink />
          </Button>
        ) : null}
        {clickUpUrl ? (
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            title={translate('auto.hq.notes.openClickUp', 'Open in ClickUp')}
            aria-label={translate('auto.hq.notes.openClickUp', 'Open in ClickUp')}
            onClick={() => void window.api.shell.openUrl(clickUpUrl)}
          >
            <ExternalLink />
          </Button>
        ) : null}
        {canRemind ? (
          <RemindButton waiting={waiting} personName={personName} hqWorktreeId={hqWorktreeId} />
        ) : null}
        <Button
          type="button"
          size="xs"
          variant="ghost"
          disabled={busy}
          onClick={() => close('cancelled')}
        >
          {translate('auto.hq.waiting.drop', 'Drop')}
        </Button>
      </span>
    </li>
  )
}
