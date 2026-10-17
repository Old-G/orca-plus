// Custom build (hq-feed): one «Incoming» feed row — its source, kind and the first lines of the text.
import {
  Bot,
  ExternalLink,
  GitCommitHorizontal,
  GitPullRequest,
  Info,
  MessageCircleQuestion,
  MessageSquare,
  MessagesSquare,
  Send,
  type LucideIcon
} from 'lucide-react'
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

export function hqFeedKindLabel(kind: string): string {
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

const KIND_ICONS: Record<string, LucideIcon> = {
  commit: GitCommitHorizontal,
  session: Bot,
  sent: Send,
  request: MessageCircleQuestion,
  conversation: MessagesSquare,
  fyi: Info,
  'my-comment': MessageSquare,
  review: GitPullRequest
}

/** What kind of event, with its own hue: work done in blue/purple/green, asks in amber. */
export function HqFeedKindChip({ kind }: { kind: string }): React.JSX.Element {
  const Icon = KIND_ICONS[kind] ?? Info
  return (
    <span
      data-kind={kind}
      className="inline-flex shrink-0 items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground data-[kind=commit]:bg-callout-note/10 data-[kind=commit]:text-callout-note data-[kind=request]:bg-status-warning-background data-[kind=request]:text-status-warning data-[kind=review]:bg-callout-note/10 data-[kind=review]:text-callout-note data-[kind=sent]:bg-status-success-background data-[kind=sent]:text-status-success data-[kind=session]:bg-callout-important/10 data-[kind=session]:text-callout-important"
    >
      <Icon className="size-3" />
      {hqFeedKindLabel(kind)}
    </span>
  )
}

export function HqFeedOpenLink({ url }: { url: string | null }): React.JSX.Element | null {
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
        <HqFeedKindChip kind={item.kind} />
        <span className="min-w-0 flex-1 truncate text-[13px]" title={item.title}>
          {item.title}
        </span>
        <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
          {formatShortTimeAgo(item.at, now)}
        </span>
        <HqFeedOpenLink url={hqFeedUrl(item.url)} />
      </div>
      {item.body ? <p className="line-clamp-2 text-xs text-muted-foreground">{item.body}</p> : null}
      {meta ? <p className="text-[11px] text-muted-foreground">{meta}</p> : null}
    </li>
  )
}
