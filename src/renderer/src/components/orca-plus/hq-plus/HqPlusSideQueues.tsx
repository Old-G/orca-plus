// Custom build (hq-plus-ui-v3): the left column's two queues as cards that act — what waits on the owner
// (open it, Done, Not now, a word to its chat) and what we wait for from people (open, Nudge, Got it).
// Every action goes the way the classic HQ does it: the bell, the waiting, the reminder through Approve.
import { useState } from 'react'
import { translate } from '@/i18n/i18n'
import { formatRelativeTime } from '@/components/activity/activity-thread-presentation'
import type { HqPlusCard } from '../../../../../shared/hq-plus-log'
import { hqPlusLook } from '../../../../../shared/hq-plus-kinds'
import { HqPlusBadges } from './HqPlusBadge'
import { HqPlusThreadComposer } from './HqPlusThreadComposer'
import { closeHqPlusWait, markHqPlusDone } from './hq-plus-actions'
import { closeHqWaiting } from '../hq/use-hq-pulse'
import { startHqChatWithPrompt } from '../hq/hq-ask-chat'
import { hqReminderPrompt } from '../hq/hq-today'

export type HqPlusOtherWait = {
  id: string
  who: string | null
  title: string
  at: number
  /** The chat that asked, when there is one. */
  sessionId: string | null
}

export type HqPlusQueueActions = {
  hqPath: string | null
  hqWorktreeId: string | null
  now: number
  onJump: (card: HqPlusCard) => void
  openChat: (sessionId: string | null) => (() => void) | null
  onNotNow: (card: HqPlusCard) => void
  onChanged: () => void
}

// Why: the column can be dragged wider; CSS clamps the text to two lines.
const SHORT = 140
// Why: the oldest few are the ones to chase; the rest open on «Show all».
const WE_WAIT_SHOWN = 6

function short(text: string): string {
  return text.length > SHORT ? `${text.slice(0, SHORT - 1)}…` : text
}

function waitingLabel(card: HqPlusCard): string {
  switch (card.type) {
    case 'approve':
      return short(card.title.replace(/^Approve:\s*/, ''))
    case 'report':
    case 'reply':
    case 'bell':
      return short(card.title)
    case 'move':
    case 'wait':
      return `${card.project ?? 'HQ'}: ${short(card.report?.ask ?? card.title)}`
  }
}

/** Done closes what the card stands for: a waiting on the owner, else its bell item. Approve answers on its card. */
function canMarkDone(card: HqPlusCard): boolean {
  return card.type !== 'approve' && (card.type === 'wait' || card.inbox !== null)
}

function WaitingCard({
  card,
  actions
}: {
  card: HqPlusCard
  actions: HqPlusQueueActions
}): React.JSX.Element {
  const [writing, setWriting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const chat = card.type === 'approve' ? null : actions.openChat(card.sessionId)
  const done = (): void => {
    setError(null)
    void (card.type === 'wait' ? closeHqPlusWait(card, 'resolved') : markHqPlusDone(card, 'done'))
      .then((result) => (result.ok ? actions.onChanged() : setError(result.message)))
      .catch((reason: unknown) => setError(String(reason)))
  }
  return (
    <div className="hqp-qcard">
      <button
        type="button"
        className="hqp-wq"
        onClick={() => {
          actions.onJump(card)
          chat?.()
        }}
      >
        <HqPlusBadges badges={hqPlusLook(card).badges} />
        <span>{waitingLabel(card)}</span>
      </button>
      <div className="hqp-qacts">
        {canMarkDone(card) ? (
          <button type="button" className="hqp-link" onClick={done}>
            {translate('auto.hqPlus.queue.done', 'Done')}
          </button>
        ) : null}
        <button
          type="button"
          className="hqp-link"
          data-ghost="true"
          onClick={() => actions.onNotNow(card)}
        >
          {translate('auto.hqPlus.notNow', 'Not now')}
        </button>
        {card.sessionId || card.address ? (
          <button
            type="button"
            className="hqp-link"
            aria-expanded={writing}
            onClick={() => setWriting(!writing)}
          >
            {translate('auto.hqPlus.queue.tell', 'Tell the chat')}
          </button>
        ) : null}
      </div>
      {writing ? (
        <HqPlusThreadComposer
          target={{
            address: card.address,
            sessionId: card.sessionId,
            replyTo: card.entry?.id ?? null,
            about: card.title
          }}
          openQuestion={null}
          label={card.address ?? card.project ?? 'chat'}
          hqPath={actions.hqPath}
          onSent={actions.onChanged}
        />
      ) : null}
      {error ? <p className="hqp-error">{error}</p> : null}
    </div>
  )
}

export function HqPlusWaitingQueue({
  waiting,
  actions
}: {
  waiting: readonly HqPlusCard[]
  actions: HqPlusQueueActions
}): React.JSX.Element {
  return (
    <div className="hqp-side-sec" data-list="waiting">
      <div className="hqp-hl hqp-side-h" data-tone="move">
        {translate('auto.hqPlus.side.waitingOnYou', 'waiting on you · {{count}}', {
          count: waiting.length
        })}
      </div>
      {waiting.length > 0 ? (
        waiting.map((card) => <WaitingCard key={card.id} card={card} actions={actions} />)
      ) : (
        <p className="hqp-empty">{translate('auto.hqPlus.side.allDone', 'all decided')}</p>
      )}
    </div>
  )
}

function WeWaitCard({
  wait,
  actions
}: {
  wait: HqPlusOtherWait
  actions: HqPlusQueueActions
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const chat = actions.openChat(wait.sessionId)
  const nudge = (): void => {
    if (!actions.hqWorktreeId) {
      return
    }
    setError(null)
    // Why: an HQ chat writes the reminder; it reaches the person only through Approve.
    void startHqChatWithPrompt(
      actions.hqWorktreeId,
      hqReminderPrompt(wait.who, wait.title),
      translate('auto.hqPlus.queue.nudgeChat', 'Nudge · {{who}}', { who: wait.who ?? 'HQ' })
    ).then((result) => setError(result.ok ? null : result.message))
  }
  const close = (): void => {
    setError(null)
    closeHqWaiting(wait.id, 'resolved')
      .then(actions.onChanged)
      .catch((reason: unknown) => setError(String(reason)))
  }
  return (
    <div className="hqp-qcard" data-kind="wait">
      <button
        type="button"
        className="hqp-wf"
        aria-expanded={open}
        title={wait.title}
        onClick={() => (chat ? chat() : setOpen(!open))}
      >
        <span>
          {wait.who ?? '\u2014'} · {open ? wait.title : short(wait.title)}
        </span>
        <span className="ag">{formatRelativeTime(wait.at, actions.now)}</span>
      </button>
      <div className="hqp-qacts">
        <button type="button" className="hqp-link" disabled={!actions.hqWorktreeId} onClick={nudge}>
          {translate('auto.hqPlus.queue.nudge', 'Nudge')}
        </button>
        <button type="button" className="hqp-link" data-ghost="true" onClick={close}>
          {translate('auto.hqPlus.queue.gotIt', 'Got it')}
        </button>
      </div>
      {error ? <p className="hqp-error">{error}</p> : null}
    </div>
  )
}

export function HqPlusWeWaitQueue({
  waits,
  actions
}: {
  waits: readonly HqPlusOtherWait[]
  actions: HqPlusQueueActions
}): React.JSX.Element | null {
  const [all, setAll] = useState(false)
  if (waits.length === 0) {
    return null
  }
  const shown = all ? waits : waits.slice(0, WE_WAIT_SHOWN)
  return (
    <div className="hqp-side-sec">
      <div className="hqp-hl hqp-side-h">
        {translate('auto.hqPlus.side.weWait', 'we wait for · {{count}}', { count: waits.length })}
      </div>
      {shown.map((wait) => (
        <WeWaitCard key={wait.id} wait={wait} actions={actions} />
      ))}
      {waits.length > WE_WAIT_SHOWN ? (
        <button type="button" className="hqp-link hqp-more" onClick={() => setAll(!all)}>
          {all
            ? translate('auto.hqPlus.side.weWaitLess', 'Show fewer')
            : translate('auto.hqPlus.side.weWaitAll', 'Show all · +{{count}}', {
                count: waits.length - WE_WAIT_SHOWN
              })}
        </button>
      ) : null}
    </div>
  )
}
