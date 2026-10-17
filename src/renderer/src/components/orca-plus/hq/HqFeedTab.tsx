// Custom build (hq-feed): HQ's «Feed» — one timeline of what happened around the owner, by day:
// Slack conversations and requests, ClickUp comments, reviews waiting on him, what Orca+ sent.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ExternalLink } from 'lucide-react'
import {
  HQ_FEED_SOURCES,
  hqFeedUrl,
  readHqFeed,
  type HqFeedItem,
  type HqFeedSource
} from '../../../../../shared/hq-feed'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { useNow } from '@/hooks/use-now'
import { translate } from '@/i18n/i18n'
import { formatShortTimeAgo } from '@/lib/short-time-ago'

const REFRESH_MS = 60_000
const AGE_TICK_MS = 60_000
const PAGE = 300
const ALL = 'all'

function sourceLabel(source: HqFeedSource): string {
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
    default:
      return kind
  }
}

function dayLabel(at: number, now: number): string {
  const day = new Date(at)
  const today = new Date(now)
  const startOf = (date: Date): number =>
    new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
  const days = Math.round((startOf(today) - startOf(day)) / 86_400_000)
  if (days === 0) {
    return translate('auto.hq.feed.today', 'Today')
  }
  if (days === 1) {
    return translate('auto.hq.feed.yesterday', 'Yesterday')
  }
  return day.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
}

type Filter = { source: HqFeedSource | null; project: string | null; query: string }

function useHqFeed(filter: Filter): { items: HqFeedItem[]; error: string | null } {
  const [items, setItems] = useState<HqFeedItem[]>([])
  const [error, setError] = useState<string | null>(null)
  const load = useCallback(async () => {
    const response = await window.api.runtime.call({
      method: 'pulse.feed',
      params: {
        limit: PAGE,
        ...(filter.source ? { source: filter.source } : {}),
        ...(filter.project ? { project: filter.project } : {}),
        ...(filter.query.trim() ? { query: filter.query.trim() } : {})
      }
    })
    if (response.ok) {
      setItems(readHqFeed(response.result))
      setError(null)
    } else {
      setError(response.error.message)
    }
  }, [filter.source, filter.project, filter.query])
  useEffect(() => {
    void load().catch((failure: unknown) => setError(String(failure)))
    const timer = setInterval(() => void load().catch(() => undefined), REFRESH_MS)
    return () => clearInterval(timer)
  }, [load])
  return { items, error }
}

function FeedRow({ item, now }: { item: HqFeedItem; now: number }): React.JSX.Element {
  const url = hqFeedUrl(item.url)
  const meta = [item.person, item.project].filter(Boolean).join(' · ')
  return (
    <li className="flex flex-col gap-1 border-b border-border py-2 last:border-b-0">
      <div className="flex items-baseline gap-2">
        <Badge variant="outline" className="shrink-0">
          {sourceLabel(item.source)}
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
        {url ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={translate('auto.hq.feed.open', 'Open')}
            onClick={() => void window.api.shell.openUrl(url)}
          >
            <ExternalLink />
          </Button>
        ) : null}
      </div>
      {item.body ? <p className="line-clamp-2 text-xs text-muted-foreground">{item.body}</p> : null}
      {meta ? <p className="text-[11px] text-muted-foreground">{meta}</p> : null}
    </li>
  )
}

export function HqFeedTab(): React.JSX.Element {
  const now = useNow(AGE_TICK_MS)
  const [filter, setFilter] = useState<Filter>({ source: null, project: null, query: '' })
  const { items, error } = useHqFeed(filter)
  const [projects, setProjects] = useState<string[]>([])
  useEffect(() => {
    // Why: the project list comes from the unfiltered feed, so picking one does not empty the menu.
    if (!filter.project) {
      setProjects(
        [...new Set(items.flatMap((item) => (item.project ? [item.project] : [])))].sort()
      )
    }
  }, [items, filter.project])
  const days = useMemo(() => {
    const groups: { label: string; items: HqFeedItem[] }[] = []
    for (const item of items) {
      const label = dayLabel(item.at, now)
      const last = groups.at(-1)
      if (last?.label === label) {
        last.items.push(item)
      } else {
        groups.push({ label, items: [item] })
      }
    }
    return groups
  }, [items, now])

  return (
    <div className="scrollbar-sleek flex h-full min-h-0 flex-col gap-3 overflow-y-auto p-4">
      <p className="text-xs text-muted-foreground">
        {translate(
          'auto.hq.feed.hint',
          'Everything around you in one timeline: Slack conversations and requests, ClickUp comments, reviews waiting on you, and what Orca+ sent for you.'
        )}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={filter.source ?? ALL}
          onValueChange={(value) =>
            setFilter((current) => ({
              ...current,
              source: HQ_FEED_SOURCES.find((source) => source === value) ?? null
            }))
          }
          aria-label={translate('auto.hq.feed.source', 'Source')}
        >
          <ToggleGroupItem value={ALL}>{translate('auto.hq.feed.all', 'All')}</ToggleGroupItem>
          {HQ_FEED_SOURCES.map((source) => (
            <ToggleGroupItem key={source} value={source}>
              {sourceLabel(source)}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        {projects.length > 0 ? (
          <Select
            value={filter.project ?? ALL}
            onValueChange={(value) =>
              setFilter((current) => ({ ...current, project: value === ALL ? null : value }))
            }
          >
            <SelectTrigger
              size="sm"
              className="w-44"
              aria-label={translate('auto.hq.feed.project', 'Project')}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>
                {translate('auto.hq.feed.allProjects', 'All projects')}
              </SelectItem>
              {projects.map((project) => (
                <SelectItem key={project} value={project}>
                  {project}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
        <Input
          value={filter.query}
          onChange={(event) => setFilter((current) => ({ ...current, query: event.target.value }))}
          placeholder={translate('auto.hq.feed.search', 'Search the feed')}
          aria-label={translate('auto.hq.feed.search', 'Search the feed')}
          className="h-8 w-48"
        />
      </div>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      {days.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {translate('auto.hq.feed.empty', 'Nothing in the feed yet.')}
        </p>
      ) : (
        days.map((day) => (
          <section key={day.label} aria-label={day.label}>
            <h3 className="text-xs font-semibold text-muted-foreground uppercase">{day.label}</h3>
            <ul className="flex flex-col">
              {day.items.map((item) => (
                <FeedRow key={item.id} item={item} now={now} />
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  )
}
