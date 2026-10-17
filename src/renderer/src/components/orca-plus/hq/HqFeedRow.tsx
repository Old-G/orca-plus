// Custom build (hq-feed): one feed row. Work done reads as a short post; what came in keeps its
// source, kind and the first lines of the text.
import { useState } from 'react'
import { ExternalLink } from 'lucide-react'
import { hqFeedUrl, type HqFeedItem, type HqFeedSource } from '../../../../../shared/hq-feed'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { formatShortTimeAgo } from '@/lib/short-time-ago'

export function hqFeedSourceLabel(source: HqFeedSource): string {
  switch (source) {
    case 'slack':
      return 'Slack'
    case 'clickup':
      return 'ClickUp'
    case 'git':
      return 'Git'
    case 'orca':
      return 'Orca+'
  }
}

function kindLabel(kind: string): string {
  switch (kind) {
    case 'request':
      return translate('auto.hq.feed.request', 'Asks you')
    case 'conversation':
      return translate('auto.hq.feed.conversation', 'Conversation')
    case 'fyi':
      return translate('auto.hq.feed.fyi', 'FYI')
    case 'my-comment':
      return translate('auto.hq.feed.myComment', 'You wrote')
    case 'review':
      return translate('auto.hq.feed.review', 'Review')
    case 'sent':
      return translate('auto.hq.feed.sent', 'Sent for you')
    case 'commit':
      return translate('auto.hq.feed.commit', 'Commit')
    case 'session':
      return translate('auto.hq.feed.session', 'Agent session')
    default:
      return kind
  }
}

function OpenLink({ url }: { url: string | null }): React.JSX.Element | null {
  return url ? (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      aria-label={translate('auto.hq.feed.open', 'Open')}
      onClick={() => void window.api.shell.openUrl(url)}
    >
      <ExternalLink />
    </Button>
  ) : null
}

export function HqFeedRow({ item, now }: { item: HqFeedItem; now: number }): React.JSX.Element {
  const meta = [item.person, item.project].filter(Boolean).join(' · ')
  return (
    <li className="flex flex-col gap-1 border-b border-border py-2 last:border-b-0">
      <div className="flex items-baseline gap-2">
        <Badge variant="outline" className="shrink-0">
          {hqFeedSourceLabel(item.source)}
        </Badge>
        <Badge variant="secondary" className="shrink-0">
          {kindLabel(item.kind)}
        </Badge>
        <span className="min-w-0 flex-1 truncate text-[13px]" title={item.title}>
          {item.title}
        </span>
        <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
          {formatShortTimeAgo(item.at, now)}
        </span>
        <OpenLink url={hqFeedUrl(item.url)} />
      </div>
      {item.body ? <p className="line-clamp-2 text-xs text-muted-foreground">{item.body}</p> : null}
      {meta ? <p className="text-[11px] text-muted-foreground">{meta}</p> : null}
    </li>
  )
}

/** Work done as a post: the readable line first, where and when under it, the original on demand. */
export function HqFeedPost({ item, now }: { item: HqFeedItem; now: number }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const meta = [item.project, kindLabel(item.kind), item.person].filter(Boolean).join(' · ')
  return (
    <li className="flex flex-col gap-1 border-b border-border py-2.5 last:border-b-0">
      <div className="flex items-start gap-2">
        <p className="min-w-0 flex-1 text-[13px] leading-snug">{item.post ?? item.title}</p>
        <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
          {formatShortTimeAgo(item.at, now)}
        </span>
        <OpenLink url={hqFeedUrl(item.url)} />
      </div>
      <div className="flex items-center gap-2">
        <p className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">{meta}</p>
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
    </li>
  )
}
