// Custom build (hq-chats): the left column of the HQ chat screen — chats grouped by what they need
// from the user, the quiet ones folded away.
import { useState } from 'react'
import { ChevronRight, Pin, PinOff, Plus } from 'lucide-react'
import { ShortcutKeyCombo } from '@/components/ShortcutKeyCombo'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'
import type { HqActiveProject } from './hq-active-projects'
import type { HqChatGroup, HqChatItem } from './hq-chat-list'
import { HqChatRow, HqNeedsChatRow } from './HqChatRow'
import { startHqChat } from './hq-new-chat'

export function hqChatGroupTitle(group: HqChatGroup): string {
  switch (group) {
    case 'needs':
      return translate('auto.hq.chats.group.needs', 'Needs you')
    case 'working':
      return translate('auto.hq.chats.group.working', 'Working')
    case 'done':
      return translate('auto.hq.chats.group.done', 'Done')
    case 'quiet':
      return translate('auto.hq.chats.group.quiet', 'Quiet')
  }
}

function GroupCaption({ group, count }: { group: HqChatGroup; count: number }): React.JSX.Element {
  return (
    <>
      <span>{hqChatGroupTitle(group)}</span>
      <span className="tabular-nums">{count}</span>
    </>
  )
}

/** A new chat in the workspace of the project's latest chat. */
function NewChatButton({ project }: { project: HqActiveProject }): React.JSX.Element | null {
  const worktreeId = project.items[0]?.worktreeId
  if (!worktreeId) {
    return null
  }
  const label = translate('auto.hq.chats.newChat', 'New chat in {{value0}}', {
    value0: project.projectName
  })
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={label}
          onClick={() => void startHqChat(worktreeId)}
        >
          <Plus className="text-muted-foreground" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={4}>
        {label}
      </TooltipContent>
    </Tooltip>
  )
}

function ActiveProjectHeader({
  project,
  color,
  onKeep
}: {
  project: HqActiveProject
  color: string
  onKeep: (repoId: string, kept: boolean) => void
}): React.JSX.Element {
  const label = project.kept
    ? translate('auto.hq.chats.unkeepProject', 'Stop keeping in HQ')
    : translate('auto.hq.chats.keepProject', 'Keep in HQ')
  return (
    <div className="flex items-center gap-1.5 pr-1 pl-2.5 text-xs">
      <span
        aria-hidden
        className="size-2 shrink-0 rounded-full"
        style={{ backgroundColor: color }}
      />
      <span className="min-w-0 flex-1 truncate font-medium">{project.projectName}</span>
      <NewChatButton project={project} />
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={label}
            aria-pressed={project.kept}
            onClick={() => onKeep(project.repoId, !project.kept)}
          >
            {project.kept ? <PinOff /> : <Pin className="text-muted-foreground" />}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top" sideOffset={4}>
          {label}
        </TooltipContent>
      </Tooltip>
    </div>
  )
}

export function HqChatList({
  groups,
  activeProjects,
  onKeepProject,
  colorFor,
  selectedKey,
  now,
  onSelect,
  onMarkDoneRead,
  onNextWaiting,
  nextWaitingKeys
}: {
  /** `groups.quiet` holds only what the active projects do not show. */
  groups: Record<HqChatGroup, HqChatItem[]>
  activeProjects: HqActiveProject[]
  onKeepProject: (repoId: string, kept: boolean) => void
  colorFor: (projectId: string) => string
  selectedKey: string | null
  now: number
  onSelect: (key: string) => void
  onMarkDoneRead: () => void
  onNextWaiting: () => void
  /** The platform's labels for the next-waiting shortcut. */
  nextWaitingKeys: string[]
}): React.JSX.Element {
  // Why: the open chat stays in view even when it is a quiet one.
  const [quietOpen, setQuietOpen] = useState(() =>
    groups.quiet.some((item) => item.key === selectedKey)
  )
  const rows = (items: HqChatItem[]) => (
    <ul className="flex flex-col gap-px">
      {items.map((item) => {
        const Row = item.kind === 'chat' && item.group === 'needs' ? HqNeedsChatRow : HqChatRow
        return (
          <Row
            key={item.key}
            item={item}
            color={colorFor(item.repoId)}
            selected={item.key === selectedKey}
            now={now}
            onSelect={onSelect}
          />
        )
      })}
    </ul>
  )
  const active = (['needs', 'working', 'done'] as const).filter((g) => groups[g].length > 0)
  return (
    <nav
      aria-label={translate('auto.hq.chats.listLabel', 'Agent chats')}
      className="scrollbar-sleek flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-2 py-3"
    >
      {active.length === 0 && activeProjects.length === 0 && groups.quiet.length === 0 ? (
        <p className="px-2.5 text-xs text-muted-foreground">
          {translate('auto.hq.chats.empty', 'No agent chats yet.')}
        </p>
      ) : null}
      {active.map((group) => (
        <section key={group} aria-label={hqChatGroupTitle(group)} className="flex flex-col gap-1">
          <div className="flex items-center px-2.5">
            <h2 className="flex flex-1 items-center gap-1.5 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
              <GroupCaption group={group} count={groups[group].length} />
            </h2>
            {group === 'needs' ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button type="button" variant="ghost" size="xs" onClick={onNextWaiting}>
                    {translate('auto.hq.chats.nextWaiting', 'Next')}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top" sideOffset={4}>
                  {translate('auto.hq.chats.nextWaitingHint', 'Next chat that waits for you')}{' '}
                  <ShortcutKeyCombo keys={nextWaitingKeys} />
                </TooltipContent>
              </Tooltip>
            ) : null}
            {group === 'done' ? (
              <Button type="button" variant="ghost" size="xs" onClick={onMarkDoneRead}>
                {translate('auto.hq.chats.markAllRead', 'Mark all read')}
              </Button>
            ) : null}
          </div>
          {rows(groups[group])}
        </section>
      ))}
      {activeProjects.length > 0 ? (
        <section
          aria-label={translate('auto.hq.chats.group.projects', 'Active projects')}
          className="flex flex-col gap-2"
        >
          <h2 className="px-2.5 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
            {translate('auto.hq.chats.group.projects', 'Active projects')}
          </h2>
          {activeProjects.map((project) => (
            <div key={project.repoId} className="flex flex-col gap-px">
              <ActiveProjectHeader
                project={project}
                color={colorFor(project.repoId)}
                onKeep={onKeepProject}
              />
              {rows(project.items)}
            </div>
          ))}
        </section>
      ) : null}
      {groups.quiet.length > 0 ? (
        <Collapsible open={quietOpen} onOpenChange={setQuietOpen}>
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="group flex w-full items-center gap-1.5 rounded-sm px-2.5 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
            >
              <ChevronRight className="size-3 transition-transform group-data-[state=open]:rotate-90" />
              <GroupCaption group="quiet" count={groups.quiet.length} />
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-1">{rows(groups.quiet)}</CollapsibleContent>
        </Collapsible>
      ) : null}
    </nav>
  )
}
