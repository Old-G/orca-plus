// Custom build (hq-plus-ui-v3): the left column's two queues as cards that act — what waits on the owner
// (open it, Done, Not now, a word to its chat) and what we wait for from people (open, Nudge, Got it).
// Every action goes the way the classic HQ does it: the bell, the waiting, the reminder through Approve.
// Custom build (hq-plus-ui-v4): the whole text, formatted, with the actions under it; sections fold smoothly.
import { useState } from 'react'
import { readHqPlusViewState, saveHqPlusViewState } from './hq-plus-view-state'
import { translate } from '@/i18n/i18n'
import { formatRelativeTime } from '@/components/activity/activity-thread-presentation'
import { Collapsible, CollapsibleContent } from '@/components/ui/collapsible'
import type { HqPlusCard } from '../../../../../shared/hq-plus-log'
import { hqPlusLook } from '../../../../../shared/hq-plus-kinds'
import { HqPlusBadges } from './HqPlusBadge'
import { HqPlusText } from './HqPlusText'
import { HqPlusThreadComposer } from './HqPlusThreadComposer'
import { canFinishHqPlusCard, finishHqPlusCard } from './hq-plus-actions'
import { hqPlusPinWhileMoving } from './hq-plus-scroll-pin'
import { closeHqWaiting } from '../hq/use-hq-pulse'
import { startHqChatWithPrompt } from '../hq/hq-ask-chat'
import { hqReminderPrompt } from '../hq/hq-today'

export type HqPlusOtherWait = {
  id: string
  who: string | null
  title: string
  /** What was saved with it: the message, the source line. */
  detail: string | null
  /** The thread or link it came from. */
  link: string | null
  project: string | null
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

// Why: the oldest few are the ones to chase; the rest open on «Show all».
const WE_WAIT_SHOWN = 6

function waitingText(card: HqPlusCard): string {
  switch (card.type) {
    case 'approve':
      return card.title.replace(/^Approve:\s*/, '')
    case 'report':
    case 'reply':
    case 'bell':
      return card.title
    case 'move':
    case 'wait':
      return `**${card.project ?? 'HQ'}:** ${card.report?.ask ?? card.title}`
  }
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
    void finishHqPlusCard(card)
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
        <span className="hqp-qtext">
          <HqPlusText text={waitingText(card)} />
        </span>
      </button>
      <div className="hqp-qacts">
        {canFinishHqPlusCard(card) ? (
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
      <Collapsible open={writing} onOpenChange={setWriting}>
        <CollapsibleContent animation="height">
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
        </CollapsibleContent>
      </Collapsible>
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
  const hasMore = Boolean(wait.detail || wait.link || wait.project)
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
  const head = (
    <>
      <span className="hqp-qtext">
        <HqPlusText text={`**${wait.who ?? '—'}** · ${wait.title}`} />
      </span>
      <span className="ag">{formatRelativeTime(wait.at, actions.now)}</span>
    </>
  )
  return (
    <div className="hqp-qcard" data-kind="wait">
      {chat || hasMore ? (
        <button
          type="button"
          className="hqp-wf"
          aria-expanded={chat ? undefined : open}
          onClick={() => (chat ? chat() : setOpen(!open))}
        >
          {head}
        </button>
      ) : (
        <div className="hqp-wf">{head}</div>
      )}
      <Collapsible open={open && !chat} onOpenChange={setOpen}>
        <CollapsibleContent animation="height">
          <div className="hqp-qmore">
            {wait.project ? <span className="hqp-chip">{wait.project}</span> : null}
            {wait.detail ? <HqPlusText text={wait.detail} /> : null}
            {wait.link ? <HqPlusText text={wait.link} /> : null}
          </div>
        </CollapsibleContent>
      </Collapsible>
      <div className="hqp-qacts">
        <button
          type="button"
          className="hqp-link"
          disabled={!actions.hqWorktreeId}
          title={
            actions.hqWorktreeId
              ? translate(
                  'auto.hqPlus.queue.nudgeHint',
                  'HQ drafts a reminder; it goes out through Approve'
                )
              : translate('auto.hq.today.noHqWorkspace', 'The HQ workspace is not open in Orca.')
          }
          onClick={nudge}
        >
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
  const [all, setAllState] = useState(() => readHqPlusViewState().showAllWaiting)
  const setAll = (next: boolean): void => {
    setAllState(next)
    saveHqPlusViewState({ showAllWaiting: next })
  }
  if (waits.length === 0) {
    return null
  }
  return (
    <div className="hqp-side-sec">
      <div className="hqp-hl hqp-side-h">
        {translate('auto.hqPlus.side.weWait', 'we wait for · {{count}}', { count: waits.length })}
      </div>
      {waits.slice(0, WE_WAIT_SHOWN).map((wait) => (
        <WeWaitCard key={wait.id} wait={wait} actions={actions} />
      ))}
      {waits.length > WE_WAIT_SHOWN ? (
        <Collapsible open={all} onOpenChange={setAll}>
          <CollapsibleContent animation="height">
            <div className="hqp-side-sec">
              {waits.slice(WE_WAIT_SHOWN).map((wait) => (
                <WeWaitCard key={wait.id} wait={wait} actions={actions} />
              ))}
            </div>
          </CollapsibleContent>
          <button
            type="button"
            className="hqp-link hqp-more"
            aria-expanded={all}
            onClick={(event) => {
              hqPlusPinWhileMoving(event.currentTarget)
              setAll(!all)
            }}
          >
            {all
              ? translate('auto.hqPlus.side.weWaitLess', 'Show fewer')
              : translate('auto.hqPlus.side.weWaitAll', 'Show all · +{{count}}', {
                  count: waits.length - WE_WAIT_SHOWN
                })}
          </button>
        </Collapsible>
      ) : null}
    </div>
  )
}
