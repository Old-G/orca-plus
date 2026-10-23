// Custom build (hq-plus-ui): HQ+'s left column — what waits on the owner (with the same badge as its card
// in the feed), what we wait for from people, the FYI pile to clear in one go, the live chats (the same
// list the classic HQ shows, so a chat started a second ago is there), and three plain numbers.
import { useState } from 'react'
import { readHqPlusViewState, saveHqPlusViewState } from './hq-plus-view-state'
import { Collapsible, CollapsibleContent } from '@/components/ui/collapsible'
import type { HqPlusCard } from '../../../../../shared/hq-plus-log'
import type { HqPlusScreenStats } from '../../../../../shared/hq-plus-screen'
import { translate } from '@/i18n/i18n'
import { formatRelativeTime } from '@/components/activity/activity-thread-presentation'
import type { HqChatGroup, HqChatItem } from '../hq/hq-chat-list'
import { useHqChatTitle } from '../hq/HqChatAvatar'
import { hqPlusChatIsIdle } from './hq-plus-chats'
import { HqPlusCloseChat, type HqPlusChatCloser } from './HqPlusCloseChat'
import {
  HqPlusWaitingQueue,
  HqPlusWeWaitQueue,
  type HqPlusOtherWait,
  type HqPlusQueueActions
} from './HqPlusSideQueues'

function dotStyle(color: string): React.CSSProperties & Record<'--hqp-dot', string> {
  return { '--hqp-dot': color }
}

const GROUP_COLOR: Record<HqChatGroup, string> = {
  needs: 'var(--hqp-amber)',
  working: 'var(--hqp-yellow)',
  done: 'var(--hqp-ice)',
  quiet: 'var(--hqp-faint)'
}

function groupLabel(item: HqChatItem, now: number): string {
  switch (item.group) {
    case 'needs':
      return translate('auto.hqPlus.side.waiting', 'waits on you')
    case 'working':
      return translate('auto.hqPlus.side.working', 'working')
    case 'done':
      return translate('auto.hqPlus.side.done', 'done')
    case 'quiet':
      // Why: a chat opened a moment ago has no turn yet; it is starting, not idle.
      return hqPlusChatIsIdle(item, now)
        ? translate('auto.hqPlus.side.idle', 'idle')
        : translate('auto.hqPlus.side.starting', 'starting')
  }
}

export type HqPlusTile = { letters: string; color: string | null }

function tileStyle(
  color: string | null
): (React.CSSProperties & Record<'--hqp-room', string>) | undefined {
  return color ? { '--hqp-room': color } : undefined
}

function ChatRow({
  item,
  picked,
  now,
  tile,
  closer,
  onPick
}: {
  item: HqChatItem
  picked: boolean
  now: number
  tile: HqPlusTile
  closer: HqPlusChatCloser | null
  onPick: (item: HqChatItem) => void
}): React.JSX.Element {
  const title = useHqChatTitle(item)
  // Custom build (hq-plus-ui-v4): a working or starting chat is yellow with a pulsing dot.
  const live = item.group === 'working' || (item.group === 'quiet' && !hqPlusChatIsIdle(item, now))
  return (
    <div className="hqp-qi-row" data-live={live ? 'true' : undefined}>
      <button
        type="button"
        className="hqp-qi ses"
        aria-current={picked ? 'true' : undefined}
        onClick={() => onPick(item)}
      >
        <span className="hqp-tile" style={tileStyle(tile.color)} aria-hidden="true">
          {tile.letters}
        </span>
        <span className="t">
          <span
            className="hqp-dot"
            style={dotStyle(live ? 'var(--hqp-yellow)' : GROUP_COLOR[item.group])}
          />
          {title}
        </span>
        <span className="ag">{groupLabel(item, now)}</span>
        <span className="s">
          {[item.projectName, item.sortAt ? formatRelativeTime(item.sortAt, now) : null]
            .filter(Boolean)
            .join(' · ')}
        </span>
      </button>
      {closer ? <HqPlusCloseChat closer={closer} name={title} /> : null}
    </div>
  )
}

export function HqPlusSide({
  waiting,
  fyi,
  waitsOnThem,
  chats,
  stats,
  picked,
  tileOf,
  closerOf,
  queue,
  onPickChat,
  onClearFyi
}: {
  waiting: HqPlusCard[]
  /** Open items for the owner's information only. */
  fyi: HqPlusCard[]
  /** What we wait for from people, oldest first. */
  waitsOnThem: HqPlusOtherWait[]
  chats: HqChatItem[]
  stats: HqPlusScreenStats | null
  /** The key of the chat open on the right. */
  picked: string | null
  tileOf: (item: HqChatItem) => HqPlusTile
  closerOf: (item: HqChatItem) => HqPlusChatCloser | null
  queue: HqPlusQueueActions
  onPickChat: (item: HqChatItem) => void
  onClearFyi: () => void
}): React.JSX.Element {
  // Custom build (hq-plus-ui-v5): the Idle fold stays as the owner left it.
  const [showIdle, setShowIdleState] = useState(() => readHqPlusViewState().showIdle)
  const setShowIdle = (next: boolean): void => {
    setShowIdleState(next)
    saveHqPlusViewState({ showIdle: next })
  }
  const now = queue.now
  // Custom build (hq-plus-ui-v3): on top what works, waits or is unread; the read, finished ones fold.
  const idle = chats.filter((item) => hqPlusChatIsIdle(item, now))
  const active = chats.filter((item) => !idle.includes(item))
  const row = (item: HqChatItem): React.JSX.Element => (
    <ChatRow
      key={item.key}
      item={item}
      picked={picked === item.key}
      now={now}
      tile={tileOf(item)}
      closer={closerOf(item)}
      onPick={onPickChat}
    />
  )
  return (
    <aside
      className="hqp-side"
      aria-label={translate('auto.hqPlus.side.label', 'Waiting on you and chats')}
    >
      <HqPlusWaitingQueue waiting={waiting} actions={queue} />
      <HqPlusWeWaitQueue waits={waitsOnThem} actions={queue} />
      {fyi.length > 0 ? (
        <div className="hqp-fyi">
          <span>
            {translate('auto.hqPlus.side.fyi', 'FYI · {{count}} — they are in the feed', {
              count: fyi.length
            })}
          </span>
          <button type="button" className="hqp-pill" onClick={onClearFyi}>
            {translate('auto.hqPlus.side.clearFyi', 'Clear all')}
          </button>
        </div>
      ) : null}
      <div className="hqp-side-sec" data-list="chats">
        <div className="hqp-hl hqp-side-h">
          {translate('auto.hqPlus.side.chats', 'chats · {{count}}', { count: chats.length })}
        </div>
        {chats.length === 0 ? (
          <p className="hqp-empty hqp-quiet">
            {translate('auto.hqPlus.side.noSessions', 'no live chats')}
          </p>
        ) : null}
        {active.map(row)}
        {idle.length > 0 ? (
          <Collapsible open={showIdle} onOpenChange={setShowIdle}>
            <button
              type="button"
              className="hqp-idle-h"
              aria-expanded={showIdle}
              onClick={() => setShowIdle(!showIdle)}
            >
              <span className="hqp-caret" data-open={showIdle} aria-hidden="true">
                {'\u25B8'}
              </span>
              {translate('auto.hqPlus.side.idleCount', 'Idle · {{count}}', { count: idle.length })}
            </button>
            <CollapsibleContent animation="height">
              <div className="hqp-side-sec">{idle.map(row)}</div>
            </CollapsibleContent>
          </Collapsible>
        ) : null}
      </div>
      <div className="hqp-stats">
        <div className="hqp-st">
          <span>
            {translate('auto.hqPlus.stat.journal', 'Journal, 24 hours')}
            <small>{translate('auto.hqPlus.stat.journalHint', 'every event in every room')}</small>
          </span>
          <b>{stats ? stats.journalDay.toLocaleString() : '—'}</b>
        </div>
        <div className="hqp-st">
          <span>
            {translate('auto.hqPlus.stat.manual', 'Done by you by hand')}
            <small>
              {stats?.manual?.perDay
                ? translate(
                    'auto.hqPlus.stat.manualHint',
                    'hand-offs, checks, «what next» today; was ~{{perDay}} a day',
                    { perDay: Math.round(stats.manual.perDay) }
                  )
                : translate(
                    'auto.hqPlus.stat.manualHintBare',
                    'hand-offs, checks, «what next» today'
                  )}
            </small>
          </span>
          <b>{stats?.manual ? stats.manual.today : '—'}</b>
        </div>
        <div className="hqp-st">
          <span>
            {translate('auto.hqPlus.stat.plan', 'HQ+ plan')}
            <small>
              {stats?.plan?.next
                ? translate('auto.hqPlus.stat.planNext', 'next: {{step}}', {
                    step: stats.plan.next
                  })
                : translate('auto.hqPlus.stat.planHint', 'steps of the plan in HQ/hq-plus.yaml')}
            </small>
          </span>
          <b>
            {stats?.plan
              ? translate('auto.hqPlus.stat.planCount', '{{done}} of {{total}}', {
                  done: stats.plan.done,
                  total: stats.plan.total
                })
              : '—'}
          </b>
        </div>
      </div>
    </aside>
  )
}
