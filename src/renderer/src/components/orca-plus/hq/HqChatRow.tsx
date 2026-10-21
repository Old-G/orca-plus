// Custom build (hq-chats): one chat in HQ's list — project mark, name, age, one line of what it
// needs or said last; a native chat waiting on a simple question answers in place, and one waiting
// on an approval shows what it would run with the way to its full card.
import { memo, useState } from 'react'
import { Bookmark, BookmarkX } from 'lucide-react'
import { AgentStateDot } from '@/components/AgentStateDot'
import { Button } from '@/components/ui/button'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger
} from '@/components/ui/context-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'
import { formatShortTimeAgo } from '@/lib/short-time-ago'
import { cn } from '@/lib/utils'
import { hqChatRecentlyDone, type HqChatItem } from './hq-chat-list'
import { HqChatAvatar, useHqChatTitle } from './HqChatAvatar'
import {
  useHqPendingPrompt,
  type HqPendingPrompt,
  type HqQuickAnswer
} from './use-hq-pending-prompt'

type RowProps = {
  item: HqChatItem
  color: string | undefined
  selected: boolean
  now: number
  onSelect: (key: string) => void
  /** Custom build (hq-marked-chats): marked to come back to. */
  marked: boolean
  onMark: (key: string, marked: boolean) => void
}

function markLabel(marked: boolean): string {
  return marked
    ? translate('auto.hq.chats.unmark', 'Remove from Come back to')
    : translate('auto.hq.chats.mark', 'Come back to this chat')
}

/** Shown while the row is hovered or marked; covers the age so the row keeps its width. */
function MarkButton({
  marked,
  onToggle
}: {
  marked: boolean
  onToggle: () => void
}): React.JSX.Element {
  const label = markLabel(marked)
  return (
    <span className="absolute top-1.5 right-1.5 rounded-md bg-accent opacity-0 group-hover/row:opacity-100 focus-within:opacity-100">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={label}
            aria-pressed={marked}
            onClick={onToggle}
          >
            {marked ? <BookmarkX /> : <Bookmark className="text-muted-foreground" />}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top" sideOffset={4}>
          {label}
        </TooltipContent>
      </Tooltip>
    </span>
  )
}

/** One line under the chat's name: the question while it waits, else the latest word from it. */
function previewLine(item: HqChatItem, prompt: HqPendingPrompt | null): string {
  const card = item.card
  if (item.group === 'needs') {
    return (
      prompt?.text ?? card?.askSummary ?? translate('auto.hq.chats.waitsForYou', 'Waiting for you')
    )
  }
  return card?.lastAgentMessage ?? card?.lastUserMessage ?? (card?.task || item.worktreeName)
}

function RowBody({
  item,
  color,
  selected,
  now,
  onSelect,
  marked,
  onMark,
  prompt,
  answers
}: RowProps & { prompt: HqPendingPrompt | null; answers: React.ReactNode }): React.JSX.Element {
  const title = useHqChatTitle(item)
  // Custom build (hq-history): a chat that just left Done keeps a mark in its project's section.
  const recentlyDone = hqChatRecentlyDone(item, now)
  const toggleMark = () => onMark(item.key, !marked)
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <li
          data-current={selected ? 'true' : undefined}
          data-recently-done={recentlyDone && !marked ? 'true' : undefined}
          data-marked={marked ? 'true' : undefined}
          title={
            recentlyDone && !marked
              ? translate('auto.hq.chats.recentlyDone', 'Finished recently')
              : undefined
          }
          className="group/row relative rounded-md border-l-2 border-transparent hover:bg-accent data-[current=true]:bg-accent data-[marked=true]:border-status-warning data-[recently-done=true]:border-status-success"
        >
          <button
            type="button"
            aria-current={selected ? 'true' : undefined}
            onClick={() => onSelect(item.key)}
            className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            <HqChatAvatar item={item} color={color} />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="flex items-baseline gap-1.5">
                <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{title}</span>
                {item.sortAt > 0 ? (
                  <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                    {formatShortTimeAgo(item.sortAt, now)}
                  </span>
                ) : null}
              </span>
              <span
                className={cn(
                  'truncate text-xs',
                  item.group === 'needs' ? 'text-agent-question-text' : 'text-muted-foreground'
                )}
              >
                <span className="font-medium text-foreground">{item.projectName}</span>
                {' · '}
                <span>{previewLine(item, prompt)}</span>
              </span>
            </span>
            {item.group === 'quiet' ? null : <AgentStateDot state={item.displayState} size="md" />}
          </button>
          <MarkButton marked={marked} onToggle={toggleMark} />
          {answers}
        </li>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={toggleMark}>
          {marked ? <BookmarkX /> : <Bookmark />}
          {markLabel(marked)}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

export const HqChatRow = memo(function HqChatRow(props: RowProps): React.JSX.Element {
  return <RowBody {...props} prompt={null} answers={null} />
})

function QuickAnswers({
  answers,
  title,
  onAnswer
}: {
  answers: HqQuickAnswer[]
  title: string
  onAnswer: (answer: HqQuickAnswer) => Promise<void>
}): React.JSX.Element {
  const [sending, setSending] = useState<string | null>(null)
  return (
    <div
      role="group"
      aria-label={translate('auto.hq.chats.answerFor', 'Answer {{value0}}', { value0: title })}
      className="flex flex-wrap gap-1 pr-2.5 pb-2 pl-12"
    >
      {answers.map((answer) => (
        <Button
          key={answer.id}
          type="button"
          variant="outline"
          size="xs"
          disabled={sending !== null}
          onClick={() => {
            setSending(answer.id)
            void onAnswer(answer).finally(() => setSending(null))
          }}
        >
          {answer.label}
        </Button>
      ))}
    </div>
  )
}

/** An approval waiting in the list: what it would run, and the way to the chat's full card, where
 *  the decision (and its scope) is made. */
function ApprovalReview({
  detail,
  onReview
}: {
  detail: string | null
  onReview: () => void
}): React.JSX.Element {
  return (
    <div className="flex items-start gap-2 pr-2.5 pb-2 pl-12">
      {detail ? (
        <code
          title={detail}
          className="line-clamp-2 min-w-0 flex-1 rounded-sm bg-muted px-1.5 py-0.5 font-mono text-[11px] break-all text-muted-foreground"
        >
          {detail}
        </code>
      ) : (
        <span className="flex-1" />
      )}
      <Button type="button" variant="outline" size="xs" onClick={onReview}>
        {translate('auto.hq.chats.reviewApproval', 'Review')}
      </Button>
    </div>
  )
}

/** A native chat that needs the user: reads what it asks, and answers a simple prompt in place. */
export const HqNeedsChatRow = memo(function HqNeedsChatRow(props: RowProps): React.JSX.Element {
  const { prompt, respond } = useHqPendingPrompt(props.item)
  const title = useHqChatTitle(props.item)
  const answers =
    prompt?.kind === 'approval' ? (
      <ApprovalReview detail={prompt.detail} onReview={() => props.onSelect(props.item.key)} />
    ) : prompt && prompt.answers.length > 0 ? (
      <QuickAnswers
        answers={prompt.answers}
        title={title}
        onAnswer={async (answer) => {
          await respond(answer.response)
        }}
      />
    ) : null
  return <RowBody {...props} prompt={prompt} answers={answers} />
})
