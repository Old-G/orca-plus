// Custom build (hq-chats): one chat in HQ's list — project mark, name, age, one line of what it
// needs or said last; a native chat waiting on a simple question answers in place, and one waiting
// on an approval shows what it would run with the way to its full card.
import { memo, useState } from 'react'
import { AgentStateDot } from '@/components/AgentStateDot'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { formatShortTimeAgo } from '@/lib/short-time-ago'
import { cn } from '@/lib/utils'
import type { HqChatItem } from './hq-chat-list'
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
  prompt,
  answers
}: RowProps & { prompt: HqPendingPrompt | null; answers: React.ReactNode }): React.JSX.Element {
  const title = useHqChatTitle(item)
  return (
    <li
      data-current={selected ? 'true' : undefined}
      className="rounded-md hover:bg-accent data-[current=true]:bg-accent"
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
      {answers}
    </li>
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
