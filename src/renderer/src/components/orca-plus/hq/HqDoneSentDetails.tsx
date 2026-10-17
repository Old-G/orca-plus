// Custom build (hq-sent-history): what one approved call in «Done for you» was — where it went, in
// which thread, from which project and chat — with the chat and the Slack thread one click away.
import { useState } from 'react'
import { ExternalLink, FolderGit2, MessagesSquare } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { slackThreadUrl } from '../../../../../shared/hq-waiting-replies'
import type { OutgoingSentContext } from '../../../../../shared/outgoing-approval/outgoing-sent-context'
import { structuredAgentSessionTabId } from '../../../../../shared/structured-agent-session-projection'
import type { HqChatItem } from './hq-chat-list'
import { openHqHistoryEntry } from './hq-history-open'
import { hqSentNames } from './hq-sent-names'

function slackUrl(sent: OutgoingSentContext): string | null {
  if (!/slack/i.test(sent.service ?? sent.head ?? '') || !sent.targetId) {
    return null
  }
  const channel = sent.targetId.split(',')[0]?.trim() ?? ''
  if (sent.threadTs && /^[CDG]/.test(channel)) {
    return slackThreadUrl(`slack:${channel}:${sent.threadTs}`)
  }
  return /^[CDGUW][A-Z0-9]+$/.test(channel)
    ? `https://slack.com/app_redirect?channel=${channel}`
    : null
}

export function HqDoneSentDetails({
  sent,
  message,
  chats
}: {
  sent: OutgoingSentContext
  message: string | null
  chats: readonly HqChatItem[]
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const names = hqSentNames(sent)
  const sessionId = sent.agentSessionId
  const tabId = sessionId ? structuredAgentSessionTabId(sessionId) : null
  // Why: older decisions never kept the workspace; the chat list still knows where the tab lives.
  const worktreeId =
    sent.worktreeId ??
    chats.find((chat) => chat.kind === 'chat' && chat.tab.id === tabId)?.worktreeId ??
    null
  const url = slackUrl(sent)
  return (
    <div className="flex flex-col gap-1 pl-1">
      {sent.threadTs ? (
        <p className="text-xs text-muted-foreground">
          {names.replyingTo
            ? translate('auto.hq.done.sentInThreadTo', 'In a thread, replying to {{value0}}', {
                value0: names.replyingTo
              })
            : translate('auto.hq.done.sentInThread', 'In a thread')}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {sent.project ? (
          <span className="flex items-center gap-1">
            <FolderGit2 className="size-3" aria-hidden />
            {sent.project}
          </span>
        ) : null}
        {names.chat ? (
          <span className="flex min-w-0 items-center gap-1">
            <MessagesSquare className="size-3 shrink-0" aria-hidden />
            <span className="truncate">«{names.chat}»</span>
          </span>
        ) : null}
        <span className="ml-auto flex items-center gap-0.5">
          {sessionId && worktreeId && tabId ? (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={() => void openHqHistoryEntry({ worktreeId, tabId, sessionId })}
            >
              <MessagesSquare />
              {translate('auto.hq.done.openChat', 'Open chat')}
            </Button>
          ) : null}
          {url ? (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={() => void window.api.shell.openUrl(url)}
            >
              <ExternalLink />
              Slack
            </Button>
          ) : null}
        </span>
      </div>
      {message ? (
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          title={
            open
              ? translate('auto.hq.done.collapse', 'Collapse')
              : translate('auto.hq.done.expand', 'Show the whole message')
          }
          data-open={open}
          className="rounded-md border border-border bg-muted/40 px-2 py-1.5 text-left text-xs whitespace-pre-wrap text-foreground line-clamp-3 hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none data-[open=true]:line-clamp-none"
        >
          {message}
        </button>
      ) : null}
    </div>
  )
}
