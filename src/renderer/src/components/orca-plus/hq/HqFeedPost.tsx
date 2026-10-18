// Custom build (hq-feed-posts): work done as a post — the project's mark in its own color (as in
// HQ's chat list), a colored chip for what kind of work it was, the readable line, the original on demand.
import { useMemo, useState } from 'react'
import { MessageSquare } from 'lucide-react'
import { hqFeedUrl, type HqFeedItem } from '../../../../../shared/hq-feed'
import { projectAccentColor } from '../../../../../shared/project-accent-color'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { formatShortTimeAgo } from '@/lib/short-time-ago'
import { useAppStore } from '@/store'
import { hqProjectInitials } from './hq-chat-list'
import { HqFeedKindChip, HqFeedOpenLink } from './HqFeedRow'
import { isHqFeedSession, openHqFeedSessionChat } from './hq-feed-open-chat'
import { hqSpaceStripeStyle } from './use-hq-spaces'

/** A feed row names its project by display name; the color is the repo's, as the chat list shows it. */
export function useHqFeedProjectColor(): (project: string) => string {
  const repos = useAppStore((state) => state.repos)
  return useMemo(() => {
    const byName = new Map(repos.map((repo) => [repo.displayName, repo]))
    return (project: string) => {
      const repo = byName.get(project)
      return projectAccentColor(repo?.id ?? project, repo?.badgeColor)
    }
  }, [repos])
}

export function HqFeedPost({
  item,
  now,
  color,
  stripe = null
}: {
  item: HqFeedItem
  now: number
  color: string | null
  /** Custom build (hq-spaces): the workspace's colour while all are shown. */
  stripe?: string | null
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  return (
    <li
      style={hqSpaceStripeStyle(stripe)}
      className="flex gap-3 rounded-lg border border-border bg-card/40 p-3 transition-colors hover:bg-accent/30"
    >
      <span
        aria-hidden
        className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted-foreground text-[11px] font-bold text-background"
        style={color ? { backgroundColor: color } : undefined}
      >
        {hqProjectInitials(item.project ?? '·')}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex min-w-0 items-center gap-2 text-[12px]">
          <span className="truncate font-semibold">{item.project ?? 'Orca+'}</span>
          <HqFeedKindChip kind={item.kind} />
          {item.person ? (
            <span className="truncate text-[11px] text-muted-foreground">{item.person}</span>
          ) : null}
          <span className="ml-auto shrink-0 text-[11px] text-muted-foreground tabular-nums">
            {formatShortTimeAgo(item.at, now)}
          </span>
          <HqFeedOpenLink url={hqFeedUrl(item.url)} />
        </div>
        <p className="text-sm leading-snug text-foreground">{item.post ?? item.title}</p>
        <div className="-ml-2 flex items-center gap-1">
          {isHqFeedSession(item) ? (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={() => void openHqFeedSessionChat(item).catch(() => undefined)}
            >
              <MessageSquare />
              {translate('auto.hq.feed.openChat', 'Open chat')}
            </Button>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            size="xs"
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
          >
            {open
              ? translate('auto.hq.feed.hideOriginal', 'Hide original')
              : translate('auto.hq.feed.showOriginal', 'Original')}
          </Button>
        </div>
        {open ? (
          <div className="flex flex-col gap-1 rounded-md bg-muted/50 p-2 text-xs text-muted-foreground">
            <p className="break-words">{item.title}</p>
            {item.body ? <p className="break-words whitespace-pre-wrap">{item.body}</p> : null}
          </div>
        ) : null}
      </div>
    </li>
  )
}
