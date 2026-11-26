// Custom build (hq-plus-ui): HQ+'s left column — what waits on the owner (with the same badge as its card
// in the feed), what we wait for from people, the FYI pile to clear in one go, the live chats (the same
// list the classic HQ shows, so a chat started a second ago is there), and three plain numbers.
import { Fragment, useEffect, useRef, useState } from 'react'
import type { HqChatLinksResult } from '../../../../../shared/hq-chat-links'
import { hqChatRoleLabel, type HqChatRole } from '../../../../../shared/hq-chat-role'
import { hqPlusChatTree } from './hq-plus-chat-tree'
import { holdSideLayout, type HqPlusSideLayout } from './hq-plus-held-layout'
import { HqPlusChatsBySwitch, useHqPlusChatsBy } from './HqPlusChatsBy'
import type { HqPlusScreenStats } from '../../../../../shared/hq-plus-screen'
import { translate } from '@/i18n/i18n'
import type { HqChatItem } from '../hq/hq-chat-list'
import type { HqPlusProjectChats } from './hq-plus-chats'
import { HqPlusNewChat, useHqPlusNewChatTargets } from './HqPlusNewChat'
import { AllProjects, ProjectHeader } from './HqPlusSideProjects'
import { HqPlusChatRow, type HqPlusTile } from './HqPlusChatRow'
import type { HqPlusChatCloser } from './HqPlusCloseChat'
import { HqPlusSideBlock } from './HqPlusSideBlock'
import type { HqPlusDraftChat } from './use-hq-plus-drafts'
import type { HqPlusOtherWait, HqPlusQueueActions } from './HqPlusSideQueues'

export type { HqPlusTile }

const noRole = (): HqChatRole | null => null

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
  slugOf,
  roleOf = noRole
}: {
  /** Custom build (hq-chat-roles): the role a chat was launched with, shown in «By work». */
  roleOf?: (item: HqChatItem) => HqChatRole | null
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
  // Custom build (hq-plus-chat-tree): By status (by project, as before) or By work (the tree).
  const [chatsBy, setChatsBy] = useHqPlusChatsBy()
  const now = queue.now
  const targets = useHqPlusNewChatTargets([])
  const targetOf = new Map(targets.map((target) => [target.repoId, target]))
  // Why every chat is listed: the owner closes chats with ✕; nothing in the column hides them (owner 23.11).
  const shownDrafts = drafts
  // Custom build (hq-plus-drafts): a chat with unsent words shows once, in Drafts.
  const drafted = new Set(shownDrafts.map((draft) => draft.item.key))
  const freshChats = {
    marked: allChats.marked.filter((item) => !drafted.has(item.key)),
    projects: allChats.projects
      .map((project) => ({
        ...project,
        items: project.items.filter((item) => !drafted.has(item.key))
      }))
      .filter((project) => project.items.length > 0 || project.kept),
    quiet: allChats.quiet.filter((item) => !drafted.has(item.key))
  }
  const byWork = chatsBy === 'work'
  const freshTree = byWork
    ? hqPlusChatTree(
        [...freshChats.marked, ...freshChats.projects.flatMap((project) => project.items)],
        chatLinks
      )
    : []
  // Custom build (hq-close-steady, owner 26.11): after a ✕ the rest of the column stays where it was
  // shown until the pointer leaves it (or a chat opens, or the grouping is switched).
  const [held, setHeld] = useState<HqPlusSideLayout | null>(null)
  const fresh: HqPlusSideLayout = { chats: freshChats, tree: freshTree }
  const holding = held ? holdSideLayout(held, fresh) : null
  if (held && !holding) {
    setHeld(null)
  }
  const shown = holding ?? fresh
  const shownRef = useRef(shown)
  useEffect(() => {
    shownRef.current = shown
  })
  const steadyCloserOf = (item: HqChatItem): HqPlusChatCloser | null => {
    const closer = closerOf(item)
    return closer
      ? {
          ...closer,
          close: () => {
            setHeld(shownRef.current)
            closer.close()
          }
        }
      : null
  }
  const chats = shown.chats
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
  const row = (
    item: HqChatItem,
    tree?: { depth: number; kids: number; headed?: boolean }
  ): React.JSX.Element => (
    <HqPlusChatRow
      key={item.key}
      item={item}
      picked={picked === item.key}
      now={now}
      tile={tileOf(item)}
      closer={steadyCloserOf(item)}
      onPick={onPickChat}
      waitsOn={waitOf(item)}
      depth={tree?.depth}
      project={tree ? slugOf(item) : undefined}
      kids={tree?.kids}
      role={tree && !tree.headed ? roleOf(item) : null}
    />
  )
  const treeRows = shown.tree
  // Custom build (hq-plus-chat-tree, owner 05.11): below the trees, every other chat by project.
  // A project whose chats all went into trees keeps its header — its «+» is the only way to start a
  // chat there, as «All projects» lists only projects with no chat (owner 07.11: «плюсик пропал»).
  const inTree = new Set(treeRows.map((entry) => entry.item.key))
  const lone = byWork
    ? chats.projects.map((project) => ({
        ...project,
        items: project.items.filter((item) => !inTree.has(item.key))
      }))
    : chats.projects
  const loneMarked = chats.marked.filter((item) => !inTree.has(item.key))
  return (
    <aside
      className="hqp-side"
      aria-label={translate('auto.hqPlus.side.label', 'Live and chats')}
      onPointerLeave={() => setHeld(null)}
    >
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
        {listed > 0 ? (
          <HqPlusChatsBySwitch
            chatsBy={chatsBy}
            onChange={(next) => {
              setHeld(null)
              setChatsBy(next)
            }}
          />
        ) : null}
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
                closer={steadyCloserOf(draft.item)}
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
          // Custom build (hq-chat-roles): a chat launched as a lead heads its tree before it starts any.
          const role = roleOf(entry.item)
          const lead = top && (entry.children > 0 || role === 'lead' || role === 'sublead')
          const before = treeRows[index - 1]
          const loneStart =
            top && !lead && !(before?.depth === 0 && !before.earlier && before.children === 0)
          return (
            <Fragment key={entry.item.key}>
              {lead ? (
                <div className="hqp-side-sub hqp-lead-h">
                  <span className="hqp-pc-lead">{hqChatRoleLabel(role ?? 'lead')}</span>
                  {translate('auto.hqPlus.side.leadOf', '{{count}} started', {
                    count: entry.children
                  })}
                </div>
              ) : loneStart ? (
                <div className="hqp-side-sub">
                  {translate('auto.hqPlus.side.leadClosed', 'Lead closed')}
                </div>
              ) : null}
              {row(entry.item, { depth: entry.depth, kids: entry.children, headed: lead })}
            </Fragment>
          )
        })}
        {loneMarked.length > 0 ? (
          <>
            <div className="hqp-side-sub">
              {translate('auto.hq.chats.group.marked', 'Come back to')} · {loneMarked.length}
            </div>
            {loneMarked.map((item) => row(item))}
          </>
        ) : null}
        {lone.map((project) => (
          <div key={project.repoId} className="hqp-pgrp-sec">
            <ProjectHeader
              project={project}
              color={colorFor(project.repoId)}
              onKeep={onKeepProject}
              target={targetOf.get(project.repoId) ?? null}
              onPickChat={onPickChat}
            />
            {project.items.map((item) => row(item))}
          </div>
        ))}
        {chats.quiet.length > 0 ? (
          // Why open, not a fold: a folded Quiet read as chats gone missing (owner 23.11).
          <>
            <div className="hqp-side-sub">
              {translate('auto.hqPlus.side.quietCount', 'Quiet · {{count}}', {
                count: chats.quiet.length
              })}
            </div>
            <div className="hqp-side-sec">{chats.quiet.map((item) => row(item))}</div>
          </>
        ) : null}
        <AllProjects
          targets={targets.filter(
            (target) =>
              !chats.projects.some((project) => project.repoId === target.repoId) &&
              !chats.quiet.some((item) => item.repoId === target.repoId)
          )}
          colorFor={colorFor}
          onPickChat={onPickChat}
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
