// Custom build (hq-plus-chats-by-project, hq-plus-all-projects, hq-plus-hide-project): a project's row in
// HQ+'s left column — New chat, its past chats, Keep and Hide — and «All projects», where every project
// with no chat listed (a hidden one among them) is found again.
import { useState } from 'react'
import { Eye, EyeOff, History, Pin, PinOff, Plus } from 'lucide-react'
import { readHqPlusViewState, saveHqPlusViewState } from './hq-plus-view-state'
import { Collapsible, CollapsibleContent } from '@/components/ui/collapsible'
import { translate } from '@/i18n/i18n'
import type { HqChatItem } from '../hq/hq-chat-list'
import type { HqPlusProjectChats } from './hq-plus-chats'
import { HqPlusProjectChatList, type HqPlusProjectTarget } from './HqPlusProjectChatList'
import { startHqChat } from '../hq/hq-new-chat'

export function tileStyle(
  color: string | null
): (React.CSSProperties & Record<'--hqp-room', string>) | undefined {
  return color ? { '--hqp-room': color } : undefined
}

export function ProjectHeader({
  project,
  color,
  onKeep,
  onHide,
  target,
  onPickChat
}: {
  project: HqPlusProjectChats
  color: string
  onKeep: (repoId: string, kept: boolean) => void
  /** Custom build (hq-plus-hide-project): out of the column with its chats; «All projects» shows it. */
  onHide: (repoId: string, hidden: boolean) => void
  /** Custom build (hq-plus-all-projects): the project's main checkout, for New chat and History. */
  target: HqPlusProjectTarget | null
  onPickChat: (item: HqChatItem) => void
}): React.JSX.Element {
  const worktreeId = project.items[0]?.worktreeId ?? target?.worktreeId
  const [history, setHistory] = useState(false)
  const historyLabel = translate('auto.hqPlus.side.projectHistory', 'Past chats of {{project}}', {
    project: project.projectName
  })
  const keepLabel = project.kept
    ? translate('auto.hq.chats.unkeepProject', 'Stop keeping in HQ')
    : translate('auto.hq.chats.keepProject', 'Keep in HQ')
  const newLabel = translate('auto.hq.chats.newChat', 'New chat in {{value0}}', {
    value0: project.projectName
  })
  const hideLabel = translate(
    'auto.hqPlus.side.hideProject',
    'Hide project (its chats stay open; find it in All projects)'
  )
  return (
    <div className="hqp-pgrp">
      <span className="hqp-pgrp-dot" style={tileStyle(color)} aria-hidden="true" />
      <span className="hqp-pgrp-name">{project.projectName}</span>
      <span className="hqp-pgrp-n">{project.items.length}</span>
      {worktreeId ? (
        <button
          type="button"
          className="hqp-pgrp-btn"
          aria-label={newLabel}
          title={newLabel}
          onClick={() => void startHqChat(worktreeId)}
        >
          <Plus aria-hidden="true" />
        </button>
      ) : null}
      {target ? (
        <button
          type="button"
          className="hqp-pgrp-btn"
          aria-label={historyLabel}
          title={historyLabel}
          aria-pressed={history}
          onClick={() => setHistory(!history)}
        >
          <History aria-hidden="true" />
        </button>
      ) : null}
      <button
        type="button"
        className="hqp-pgrp-btn"
        aria-label={keepLabel}
        title={keepLabel}
        aria-pressed={project.kept}
        onClick={() => onKeep(project.repoId, !project.kept)}
      >
        {project.kept ? <PinOff aria-hidden="true" /> : <Pin aria-hidden="true" />}
      </button>
      <button
        type="button"
        className="hqp-pgrp-btn"
        aria-label={hideLabel}
        title={hideLabel}
        onClick={() => onHide(project.repoId, true)}
      >
        <EyeOff aria-hidden="true" />
      </button>
      {history && target ? (
        <div className="hqp-pgrp-hist">
          <HqPlusProjectChatList
            target={target}
            open={[]}
            color={color}
            onPickOpen={onPickChat}
            onDone={() => setHistory(false)}
          />
        </div>
      ) : null}
    </div>
  )
}

/**
 * Custom build (hq-plus-all-projects): every project of the sidebar that has no chat open here, folded —
 * none drops out of HQ+ for being quiet (owner, 30.10: «IT Hub just vanished»). A click opens its
 * New chat and past chats in place.
 */
export function AllProjects({
  targets,
  colorFor,
  onPickChat,
  hiddenIds,
  onHide
}: {
  targets: readonly HqPlusProjectTarget[]
  colorFor: (repoId: string) => string
  onPickChat: (item: HqChatItem) => void
  /** Custom build (hq-plus-hide-project): hidden projects are found here and shown again. */
  hiddenIds: readonly string[]
  onHide: (repoId: string, hidden: boolean) => void
}): React.JSX.Element | null {
  const [show, setShowState] = useState(() => readHqPlusViewState().showAllProjects)
  const setShow = (next: boolean): void => {
    setShowState(next)
    saveHqPlusViewState({ showAllProjects: next })
  }
  const [query, setQuery] = useState('')
  const [openRepo, setOpenRepo] = useState<string | null>(null)
  if (targets.length === 0) {
    return null
  }
  const needle = query.trim().toLowerCase()
  const shown = needle ? targets.filter((t) => t.name.toLowerCase().includes(needle)) : targets
  return (
    <Collapsible open={show} onOpenChange={setShow}>
      <button
        type="button"
        className="hqp-idle-h"
        aria-expanded={show}
        onClick={() => setShow(!show)}
      >
        <span className="hqp-caret" data-open={show} aria-hidden="true">
          {'\u25B8'}
        </span>
        {translate('auto.hqPlus.side.allProjects', 'All projects · {{count}}', {
          count: targets.length
        })}
      </button>
      <CollapsibleContent animation="height">
        <div className="hqp-side-sec">
          {targets.length > 6 ? (
            <input
              className="hqp-roomform-in hqp-allproj-q"
              aria-label={translate('auto.hqPlus.side.newChatSearch', 'Project')}
              placeholder={translate('auto.hqPlus.side.newChatPlaceholder', 'Project…')}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          ) : null}
          {shown.map((target) => (
            <div key={target.repoId} className="hqp-pgrp-sec">
              <div className="hqp-allproj-row">
                <button
                  type="button"
                  className="hqp-pgrp hqp-allproj"
                  aria-expanded={openRepo === target.repoId}
                  onClick={() => setOpenRepo(openRepo === target.repoId ? null : target.repoId)}
                >
                  <span
                    className="hqp-pgrp-dot"
                    style={tileStyle(colorFor(target.repoId))}
                    aria-hidden="true"
                  />
                  <span className="hqp-pgrp-name">{target.name}</span>
                  {hiddenIds.includes(target.repoId) ? (
                    <span className="hqp-pgrp-n">
                      {translate('auto.hqPlus.side.hiddenProject', 'hidden')}
                    </span>
                  ) : null}
                </button>
                {hiddenIds.includes(target.repoId) ? (
                  <button
                    type="button"
                    className="hqp-pgrp-btn"
                    aria-label={translate('auto.hqPlus.side.showProject', 'Show in the list')}
                    title={translate('auto.hqPlus.side.showProject', 'Show in the list')}
                    onClick={() => onHide(target.repoId, false)}
                  >
                    <Eye aria-hidden="true" />
                  </button>
                ) : null}
              </div>
              {openRepo === target.repoId ? (
                <div className="hqp-pgrp-hist">
                  <HqPlusProjectChatList
                    target={target}
                    open={[]}
                    color={colorFor(target.repoId)}
                    onPickOpen={onPickChat}
                    onDone={() => setOpenRepo(null)}
                  />
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
