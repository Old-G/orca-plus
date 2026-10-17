// Custom build (hq-feed): HQ's «Feed», by day. «Done» (hq-feed-posts): commits, finished agent
// sessions and messages sent, as short posts. «Incoming»: Slack, ClickUp comments, reviews waiting on him.
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  HQ_FEED_SOURCES,
  readHqFeed,
  type HqFeedItem,
  type HqFeedSource
} from '../../../../../shared/hq-feed'
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
import { HqFeedPost, HqFeedRow, hqFeedSourceLabel } from './HqFeedRow'

const REFRESH_MS = 60_000
const AGE_TICK_MS = 60_000
const PAGE = 300
const ALL = 'all'
// Why: work done comes from git and Orca+ only; nothing from Orca+ is «incoming».
const SCOPE_SOURCES: Record<'done' | 'incoming', readonly HqFeedSource[]> = {
  done: ['git', 'orca'],
  incoming: HQ_FEED_SOURCES.filter((source) => source !== 'orca')
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

type Scope = keyof typeof SCOPE_SOURCES
type Filter = {
  scope: Scope
  source: HqFeedSource | null
  project: string | null
  query: string
}

function useHqFeed(filter: Filter): { items: HqFeedItem[]; error: string | null } {
  const [items, setItems] = useState<HqFeedItem[]>([])
  const [error, setError] = useState<string | null>(null)
  const load = useCallback(async () => {
    const response = await window.api.runtime.call({
      method: 'pulse.feed',
      params: {
        limit: PAGE,
        scope: filter.scope,
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
  }, [filter.scope, filter.source, filter.project, filter.query])
  useEffect(() => {
    void load().catch((failure: unknown) => setError(String(failure)))
    const timer = setInterval(() => void load().catch(() => undefined), REFRESH_MS)
    return () => clearInterval(timer)
  }, [load])
  return { items, error }
}

export function HqFeedTab(): React.JSX.Element {
  const now = useNow(AGE_TICK_MS)
  const [filter, setFilter] = useState<Filter>({
    scope: 'done',
    source: null,
    project: null,
    query: ''
  })
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
      <div className="flex flex-wrap items-center gap-2">
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={filter.scope}
          onValueChange={(value) => {
            if (value === 'done' || value === 'incoming') {
              setFilter((current) => ({ ...current, scope: value, source: null }))
            }
          }}
          aria-label={translate('auto.hq.feed.scope', 'What to show')}
        >
          <ToggleGroupItem value="done">{translate('auto.hq.feed.done', 'Done')}</ToggleGroupItem>
          <ToggleGroupItem value="incoming">
            {translate('auto.hq.feed.incoming', 'Incoming')}
          </ToggleGroupItem>
        </ToggleGroup>
        <p className="min-w-0 flex-1 text-xs text-muted-foreground">
          {filter.scope === 'done'
            ? translate(
                'auto.hq.feed.doneHint',
                'What was done: commits, finished agent sessions and messages sent for you.'
              )
            : translate(
                'auto.hq.feed.incomingHint',
                'What came in: Slack conversations and requests, ClickUp comments, reviews waiting on you.'
              )}
        </p>
      </div>
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
          {SCOPE_SOURCES[filter.scope].map((source) => (
            <ToggleGroupItem key={source} value={source}>
              {hqFeedSourceLabel(source)}
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
              {day.items.map((item) =>
                filter.scope === 'done' ? (
                  <HqFeedPost key={item.id} item={item} now={now} />
                ) : (
                  <HqFeedRow key={item.id} item={item} now={now} />
                )
              )}
            </ul>
          </section>
        ))
      )}
    </div>
  )
}
