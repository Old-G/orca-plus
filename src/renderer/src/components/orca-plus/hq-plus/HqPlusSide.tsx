// Custom build (hq-plus-ui): HQ+'s left column — what waits on the owner (with the same badge as its card
// in the feed), what we wait for from people, the FYI pile to clear in one go, the live chats (the same
// list the classic HQ shows, so a chat started a second ago is there), and three plain numbers.
import { useState } from 'react'
import { Pin, PinOff, Plus } from 'lucide-react'
import { readHqPlusViewState, saveHqPlusViewState } from './hq-plus-view-state'
import { Collapsible, CollapsibleContent } from '@/components/ui/collapsible'
import type { HqPlusCard } from '../../../../../shared/hq-plus-log'
import type { HqPlusScreenStats } from '../../../../../shared/hq-plus-screen'
import { translate } from '@/i18n/i18n'
import { formatRelativeTime } from '@/components/activity/activity-thread-presentation'
import type { HqChatItem } from '../hq/hq-chat-list'
import { useHqChatTitle } from '../hq/HqChatAvatar'
import { hqPlusChatIsIdle, type HqPlusProjectChats } from './hq-plus-chats'
import { HqPlusNewChat } from './HqPlusNewChat'
import { startHqChat } from '../hq/hq-new-chat'
import { HqPlusCloseChat, type HqPlusChatCloser } from './HqPlusCloseChat'
import { HqPlusSideBlock } from './HqPlusSideBlock'
import {
  HqPlusWaitingQueue,
  HqPlusWeWaitQueue,
  type HqPlusOtherWait,
  type HqPlusQueueActions
} from './HqPlusSideQueues'

/** Custom build (hq-plus-chats-by-project): what the chat is doing, as a coloured chip; none once read. */
function chipOf(item: HqChatItem, now: number): { label: string; tone: string } | null {
  switch (item.group) {
    case 'needs':
      return { label: translate('auto.hqPlus.side.waiting', 'waits on you'), tone: 'move' }
    case 'working':
      return { label: translate('auto.hqPlus.side.working', 'working'), tone: 'working' }
    case 'done':
      return { label: translate('auto.hqPlus.side.done', 'done'), tone: 'done' }
    case 'quiet':
      // Why: a chat opened a moment ago has no turn yet; it is starting, not idle.
      return hqPlusChatIsIdle(item, now)
        ? null
        : { label: translate('auto.hqPlus.side.starting', 'starting'), tone: 'working' }
  }
}

/** One line under the chat's name: the question while it waits, else the latest word from it. */
function previewOf(item: HqChatItem): string {
  const card = item.card
  if (item.group === 'needs') {
    return card?.askSummary ?? translate('auto.hq.chats.waitsForYou', 'Waiting for you')
  }
  return card?.lastAgentMessage ?? card?.lastUserMessage ?? (card?.task || item.worktreeName)
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
  const chip = chipOf(item, now)
  // Custom build (hq-plus-ui-v4): a working or starting chat pulses.
  const live = item.group === 'working' || (item.group === 'quiet' && !hqPlusChatIsIdle(item, now))
  return (
    <div className="hqp-qi-row" data-live={live ? 'true' : undefined}>
      <button
        type="button"
        className="hqp-pc"
        aria-current={picked ? 'true' : undefined}
        data-read={chip ? undefined : 'true'}
        onClick={() => onPick(item)}
      >
        <span className="hqp-tile" style={tileStyle(tile.color)} aria-hidden="true">
          {tile.letters}
        </span>
        <span className="t">
          {chip ? (
            <span className="hqp-badge" data-tone={chip.tone}>
              {chip.label}
            </span>
          ) : null}
          {title}
        </span>
        <span className="w">{item.sortAt ? formatRelativeTime(item.sortAt, now) : ''}</span>
        <span className="s">{previewOf(item)}</span>
      </button>
      {closer ? <HqPlusCloseChat closer={closer} name={title} /> : null}
    </div>
  )
}

function ProjectHeader({
  project,
  color,
  onKeep
}: {
  project: HqPlusProjectChats
  color: string
  onKeep: (repoId: string, kept: boolean) => void
}): React.JSX.Element {
  const worktreeId = project.items[0]?.worktreeId
  const keepLabel = project.kept
    ? translate('auto.hq.chats.unkeepProject', 'Stop keeping in HQ')
    : translate('auto.hq.chats.keepProject', 'Keep in HQ')
  const newLabel = translate('auto.hq.chats.newChat', 'New chat in {{value0}}', {
    value0: project.projectName
  })
  return (
    <div className="hqp-proj">
      <span className="hqp-proj-dot" style={tileStyle(color)} aria-hidden="true" />
      <span className="hqp-proj-name">{project.projectName}</span>
      <span className="hqp-proj-n">{project.items.length}</span>
      {worktreeId ? (
        <button
          type="button"
          className="hqp-proj-btn"
          aria-label={newLabel}
          title={newLabel}
          onClick={() => void startHqChat(worktreeId)}
        >
          <Plus aria-hidden="true" />
        </button>
      ) : null}
      <button
        type="button"
        className="hqp-proj-btn"
        aria-label={keepLabel}
        title={keepLabel}
        aria-pressed={project.kept}
        onClick={() => onKeep(project.repoId, !project.kept)}
      >
        {project.kept ? <PinOff aria-hidden="true" /> : <Pin aria-hidden="true" />}
      </button>
    </div>
  )
}

export function HqPlusSide({
  waiting,
  fyi,
  waitsOnThem,
  chats,
  colorFor,
  tileOfRepo,
  onKeepProject,
  onMarkDoneRead,
  stats,
  picked,
  tileOf,
  closerOf,
  queue,
  onPickChat,
  onClearFyi,
}: {
  waiting: HqPlusCard[]
  /** Open items for the owner's information only. */
  fyi: HqPlusCard[]
  /** What we wait for from people, oldest first. */
  waitsOnThem: HqPlusOtherWait[]
  /** Custom build (hq-plus-chats-by-project): the chats by project, as the classic HQ lists them. */
  chats: { marked: HqChatItem[]; projects: HqPlusProjectChats[]; quiet: HqChatItem[] }
  colorFor: (repoId: string) => string
  tileOfRepo: (repoId: string, name: string) => HqPlusTile
  onKeepProject: (repoId: string, kept: boolean) => void
  onMarkDoneRead: (items: HqChatItem[]) => void
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
  const listed = chats.marked.length + chats.projects.reduce((n, p) => n + p.items.length, 0)
  const done = [...chats.marked, ...chats.projects.flatMap((project) => project.items)].filter(
    (item) => item.group === 'done'
  )
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
      <HqPlusSideBlock
        id="chats"
        title={translate('auto.hqPlus.side.chats', 'chats · {{count}}', { count: listed })}
        actions={
          <>
            {done.length > 0 ? (
              <button type="button" className="hqp-pill" onClick={() => onMarkDoneRead(done)}>
                {translate('auto.hqPlus.side.markDoneRead', 'Mark done read')}
              </button>
            ) : null}
            <HqPlusNewChat
              activeRepoIds={chats.projects.map((project) => project.repoId)}
              tileOf={tileOfRepo}
            />
          </>
        }
      >
        {listed === 0 && chats.quiet.length === 0 ? (
          <p className="hqp-empty hqp-quiet">
            {translate('auto.hqPlus.side.noSessions', 'no live chats')}
          </p>
        ) : null}
        {chats.marked.length > 0 ? (
          <>
            <div className="hqp-side-sub">
              {translate('auto.hq.chats.group.marked', 'Come back to')} · {chats.marked.length}
            </div>
            {chats.marked.map(row)}
          </>
        ) : null}
        {chats.projects.map((project) => (
          <div key={project.repoId} className="hqp-proj-sec">
            <ProjectHeader
              project={project}
              color={colorFor(project.repoId)}
              onKeep={onKeepProject}
            />
            {project.items.map(row)}
          </div>
        ))}
        {chats.quiet.length > 0 ? (
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
              {translate('auto.hqPlus.side.quietCount', 'Quiet · {{count}}', {
                count: chats.quiet.length
              })}
            </button>
            <CollapsibleContent animation="height">
              <div className="hqp-side-sec">{chats.quiet.map(row)}</div>
            </CollapsibleContent>
          </Collapsible>
        ) : null}
      </HqPlusSideBlock>
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
