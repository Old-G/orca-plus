// Custom build (hq-chats): the panel beside an open HQ chat — its workspace's uncommitted changes
// (a click opens the diff), the linked review with its checks, the linked task, and the project's
// other chats.
import { ExternalLink } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import { STATUS_COLORS, STATUS_LABELS } from '../../right-sidebar/status-display'
import { ReviewChecksBadge, ReviewStateBadge } from '../../sidebar/WorktreeCardMetadataStatusBadges'
import { openHqChangeDiff } from './hq-chat-actions'
import type { HqChatItem } from './hq-chat-list'
import { HqChatAvatar, useHqChatTitle } from './HqChatAvatar'
import { useHqChatContext } from './use-hq-chat-context'

const MAX_CHANGES = 12

function Caption({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <h3 className="mb-1.5 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
      {children}
    </h3>
  )
}

function OtherChat({
  item,
  color,
  onSelect
}: {
  item: HqChatItem
  color: string
  onSelect: (key: string) => void
}): React.JSX.Element {
  const title = useHqChatTitle(item)
  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(item.key)}
        className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-xs hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        <HqChatAvatar item={item} color={color} />
        <span className="min-w-0 flex-1 truncate">{title}</span>
      </button>
    </li>
  )
}

function LinkRow({ url, children }: { url: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={() => void window.api.shell.openUrl(url)}
      className="flex w-full items-center gap-1.5 rounded-md text-left text-xs hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
    >
      <span className="min-w-0 flex-1 truncate">{children}</span>
      <ExternalLink className="size-3 shrink-0 text-muted-foreground" />
    </button>
  )
}

export function HqContextPanel({
  item,
  siblings,
  colorFor,
  onSelect
}: {
  item: HqChatItem
  /** The project's other chats. */
  siblings: readonly HqChatItem[]
  colorFor: (projectId: string) => string
  onSelect: (key: string) => void
}): React.JSX.Element {
  const context = useHqChatContext(item.worktreeId)
  const { worktree, changes, review, task } = context
  const shown = changes.slice(0, MAX_CHANGES)
  return (
    <aside
      aria-label={translate('auto.hq.context.label', 'Chat context')}
      className="scrollbar-sleek flex h-full w-64 shrink-0 flex-col gap-5 overflow-y-auto border-l border-border px-3 py-3"
    >
      <section>
        <Caption>
          {translate('auto.hq.context.changes', 'Changes')}
          {changes.length > 0 ? ` · ${changes.length}` : ''}
        </Caption>
        {!worktree || !context.branch ? (
          <p className="text-xs text-muted-foreground">
            {translate('auto.hq.context.noGit', 'No git branch to show changes for.')}
          </p>
        ) : changes.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            {translate('auto.hq.context.noChanges', 'No uncommitted changes.')}
          </p>
        ) : (
          <ul className="flex flex-col">
            {shown.map((entry) => (
              <li key={`${entry.area}:${entry.path}`}>
                <button
                  type="button"
                  title={entry.path}
                  onClick={() => openHqChangeDiff(worktree, entry)}
                  className="flex w-full items-center gap-1.5 rounded-md px-1 py-0.5 text-left font-mono text-[11px] hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
                >
                  <span className="w-3 shrink-0" style={{ color: STATUS_COLORS[entry.status] }}>
                    {STATUS_LABELS[entry.status]}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{entry.path}</span>
                  {entry.added !== undefined ? (
                    <span className="shrink-0 tabular-nums text-muted-foreground">
                      +{entry.added} −{entry.removed ?? 0}
                    </span>
                  ) : null}
                </button>
              </li>
            ))}
            {changes.length > shown.length ? (
              <li className="px-1 text-[11px] text-muted-foreground">
                {translate('auto.hq.context.moreChanges', '+{{count}} more', {
                  count: changes.length - shown.length
                })}
              </li>
            ) : null}
          </ul>
        )}
      </section>
      {review ? (
        <section>
          <Caption>{translate('auto.hq.context.review', 'Review')}</Caption>
          <div className="flex items-center gap-1.5">
            <ReviewStateBadge state={review.state} label={review.label} />
            <ReviewChecksBadge status={review.status} />
            <LinkRow url={review.url}>
              {review.label} #{review.number} {review.title}
            </LinkRow>
          </div>
        </section>
      ) : null}
      {task ? (
        <section>
          <Caption>{translate('auto.hq.context.task', 'Task')}</Caption>
          <LinkRow url={task.url}>
            {task.label}
            {task.title ? ` · ${task.title}` : ''}
          </LinkRow>
        </section>
      ) : null}
      {siblings.length > 0 ? (
        <section>
          <Caption>
            {translate('auto.hq.context.otherChats', 'Other chats here')} · {siblings.length}
          </Caption>
          <ul className="flex flex-col gap-px">
            {siblings.map((sibling) => (
              <OtherChat
                key={sibling.key}
                item={sibling}
                color={colorFor(sibling.repoId)}
                onSelect={onSelect}
              />
            ))}
          </ul>
        </section>
      ) : null}
    </aside>
  )
}
