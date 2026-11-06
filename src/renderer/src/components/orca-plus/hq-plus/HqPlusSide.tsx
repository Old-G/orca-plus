// Custom build (hq-plus-ui): HQ+'s left column — what waits on the owner (with the same badge as its card
// in the feed), what we wait for from people, the FYI pile to clear in one go, the live chats (the same
// list the classic HQ shows, so a chat started a second ago is there), and three plain numbers.
import { Fragment, useState } from 'react'
import { readHqPlusViewState, saveHqPlusViewState } from './hq-plus-view-state'
import type { HqChatLinksResult } from '../../../../../shared/hq-chat-links'
import { hqPlusChatTree } from './hq-plus-chat-tree'
import { HqPlusChatsBySwitch, useHqPlusChatsBy } from './HqPlusChatsBy'
import { Collapsible, CollapsibleContent } from '@/components/ui/collapsible'
import type { HqPlusScreenStats } from '../../../../../shared/hq-plus-screen'
import { translate } from '@/i18n/i18n'
import type { HqChatItem } from '../hq/hq-chat-list'
import type { HqPlusProjectChats } from './hq-plus-chats'
import { HqPlusNewChat, useHqPlusNewChatTargets } from './HqPlusNewChat'
import { AllProjects, ProjectHeader } from './HqPlusSideProjects'
import { HqPlusChatRow, type HqPlusTile } from './HqPlusChatRow'
import { useAppStore } from '@/store'
import { setHqProjectHidden } from '../hq/hq-chat-actions'
import type { HqPlusChatCloser } from './HqPlusCloseChat'
import { HqPlusSideBlock } from './HqPlusSideBlock'
import type { HqPlusDraftChat } from './use-hq-plus-drafts'
import type { HqPlusOtherWait, HqPlusQueueActions } from './HqPlusSideQueues'

export type { HqPlusTile }

const NO_HIDDEN: readonly string[] = []

export function HqPlusSide({
  ticker,
  waitsOnThem,
  chats: allChats,
  drafts,
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
  openChats,
  chatLinks,
  slugOf
}: {
  /** Custom build (hq-plus-work-view): the project's HQ name for a chat, as its tile is built from. */
  slugOf: (item: HqChatItem) => string
  /** Custom build (hq-plus-chat-tree): which chat started which, for «By work». */
  chatLinks: HqChatLinksResult | null
  /** Custom build (hq-plus-all-projects): every chat open as a tab, any room. */
  openChats: readonly HqChatItem[]
  /** Custom build (hq-plus-ticker): the live strip above the chats. */
  ticker: React.ReactNode
  /** What we wait for from people, oldest first; each chat row says whom it waits on. */
  waitsOnThem: HqPlusOtherWait[]
  /** Custom build (hq-plus-chats-by-project): the chats by project, as the classic HQ lists them. */
  chats: { marked: HqChatItem[]; projects: HqPlusProjectChats[]; quiet: HqChatItem[] }
  /** Custom build (hq-plus-drafts): chats with unsent words, above the rest. */
  drafts: HqPlusDraftChat[]
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
}): React.JSX.Element {
  // Custom build (hq-plus-ui-v5): the Idle fold stays as the owner left it.
  const [showIdle, setShowIdleState] = useState(() => readHqPlusViewState().showIdle)
  const setShowIdle = (next: boolean): void => {
    setShowIdleState(next)
    saveHqPlusViewState({ showIdle: next })
  }
  // Custom build (hq-plus-chat-tree): By status (by project, as before) or By work (the tree).
  const [chatsBy, setChatsBy] = useHqPlusChatsBy()
  const now = queue.now
  const targets = useHqPlusNewChatTargets([])
  const targetOf = new Map(targets.map((target) => [target.repoId, target]))
  // Custom build (hq-plus-hide-project): a hidden project leaves the column with its chats and drafts;
  // «All projects» shows it again.
  const hiddenIds = useAppStore((state) => state.settings?.hqHiddenProjectIds) ?? NO_HIDDEN
  const shownDrafts = drafts.filter((draft) => !hiddenIds.includes(draft.item.repoId))
  // Custom build (hq-plus-drafts): a chat with unsent words shows once, in Drafts.
  const drafted = new Set(shownDrafts.map((draft) => draft.item.key))
  const chats = {
    marked: allChats.marked.filter(
      (item) => !drafted.has(item.key) && !hiddenIds.includes(item.repoId)
    ),
    projects: allChats.projects
      .filter((project) => !hiddenIds.includes(project.repoId))
      .map((project) => ({
        ...project,
        items: project.items.filter((item) => !drafted.has(item.key))
      }))
      .filter((project) => project.items.length > 0 || project.kept),
    quiet: allChats.quiet.filter((item) => !drafted.has(item.key))
  }
  const listed = chats.marked.length + chats.projects.reduce((n, p) => n + p.items.length, 0)
  const done = [...chats.marked, ...chats.projects.flatMap((project) => project.items)].filter(
    (item) => item.group === 'done'
  )
  // Custom build (hq-plus-chat-waits): the person each chat waits on, by its session.
  const waitOfSession = new Map<string, HqPlusOtherWait>()
  for (const wait of waitsOnThem) {
    if (wait.sessionId && !waitOfSession.has(wait.sessionId)) {
      waitOfSession.set(wait.sessionId, wait)
    }
  }
  const waitOf = (item: HqChatItem): HqPlusOtherWait | null =>
    item.kind === 'chat' ? (waitOfSession.get(item.tab.entityId) ?? null) : null
  const row = (item: HqChatItem, tree?: { depth: number; kids: number }): React.JSX.Element => (
    <HqPlusChatRow
      key={item.key}
      item={item}
      picked={picked === item.key}
      now={now}
      tile={tileOf(item)}
      closer={closerOf(item)}
      onPick={onPickChat}
      waitsOn={waitOf(item)}
      depth={tree?.depth}
      project={tree ? slugOf(item) : undefined}
      kids={tree?.kids}
    />
  )
  const byWork = chatsBy === 'work'
  const treeRows = byWork
    ? hqPlusChatTree(
        [...chats.marked, ...chats.projects.flatMap((project) => project.items)],
        chatLinks
      )
    : []
  // Custom build (hq-plus-chat-tree, owner 05.11): below the trees, every other chat by project.
  const inTree = new Set(treeRows.map((entry) => entry.item.key))
  const lone = byWork
    ? chats.projects
        .map((project) => ({
          ...project,
          items: project.items.filter((item) => !inTree.has(item.key))
        }))
        .filter((project) => project.items.length > 0 || project.kept)
    : chats.projects
  const loneMarked = chats.marked.filter((item) => !inTree.has(item.key))
  return (
    <aside className="hqp-side" aria-label={translate('auto.hqPlus.side.label', 'Live and chats')}>
      {/* Custom build (hq-plus-ticker): «Waiting on you» and «We wait for» live in the feed's chips now;
          their place is a live strip of what comes in and what the chats do (owner, 28.10). */}
      {ticker}
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
              openChats={openChats}
              onPickChat={onPickChat}
            />
          </>
        }
      >
        {listed === 0 && chats.quiet.length === 0 && shownDrafts.length === 0 ? (
          <p className="hqp-empty hqp-quiet">
            {translate('auto.hqPlus.side.noSessions', 'no live chats')}
          </p>
        ) : null}
        {listed > 0 ? <HqPlusChatsBySwitch chatsBy={chatsBy} onChange={setChatsBy} /> : null}
        {shownDrafts.length > 0 ? (
          <>
            <div className="hqp-side-sub">
              {translate('auto.hqPlus.side.drafts', 'Drafts')} · {shownDrafts.length}
            </div>
            {shownDrafts.map((draft) => (
              <HqPlusChatRow
                key={draft.item.key}
                item={draft.item}
                picked={picked === draft.item.key}
                now={now}
                tile={tileOf(draft.item)}
                closer={closerOf(draft.item)}
                onPick={onPickChat}
                draft={draft.text}
              />
            ))}
          </>
        ) : null}
        {/* Custom build (hq-plus-work-view, owner 06.11): each tree opens with its lead (the «lead» skill);
            chats whose lead is closed gather under one line. */}
        {treeRows.map((entry, index) => {
          const top = entry.depth === 0 && !entry.earlier
          const lead = top && entry.children > 0
          const before = treeRows[index - 1]
          const loneStart =
            top && !lead && !(before?.depth === 0 && !before.earlier && before.children === 0)
          return (
            <Fragment key={entry.item.key}>
              {lead ? (
                <div className="hqp-side-sub hqp-lead-h">
                  <span className="hqp-pc-lead">LEAD</span>
                  {translate('auto.hqPlus.side.leadOf', '{{count}} started', {
                    count: entry.children
                  })}
                </div>
              ) : loneStart ? (
                <div className="hqp-side-sub">
                  {translate('auto.hqPlus.side.leadClosed', 'Lead closed')}
                </div>
              ) : null}
              {row(entry.item, { depth: entry.depth, kids: entry.children })}
            </Fragment>
          )
        })}
        {loneMarked.length > 0 ? (
          <>
            <div className="hqp-side-sub">
              {translate('auto.hq.chats.group.marked', 'Come back to')} · {loneMarked.length}
            </div>
            {loneMarked.map(row)}
          </>
        ) : null}
        {lone.map((project) => (
          <div key={project.repoId} className="hqp-pgrp-sec">
            <ProjectHeader
              project={project}
              color={colorFor(project.repoId)}
              onKeep={onKeepProject}
              onHide={setHqProjectHidden}
              target={targetOf.get(project.repoId) ?? null}
              onPickChat={onPickChat}
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
        <AllProjects
          targets={targets.filter(
            (target) =>
              !chats.projects.some((project) => project.repoId === target.repoId) &&
              !chats.quiet.some((item) => item.repoId === target.repoId)
          )}
          colorFor={colorFor}
          onPickChat={onPickChat}
          hiddenIds={hiddenIds}
          onHide={setHqProjectHidden}
        />
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
