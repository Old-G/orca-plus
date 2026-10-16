// Custom build (hq-history): HQ's History — the agent chats that finished over the last week, by day,
// closed ones included; a click opens the chat here.
import { useMemo, useState } from 'react'
import {
  groupHqChatHistoryByDay,
  hqHistoryDaysAgo,
  type HqHistoryEntry
} from '../../../../../shared/hq-chat-history'
import type { Tab } from '../../../../../shared/tab-types'
import { Badge } from '@/components/ui/badge'
import { useNow } from '@/hooks/use-now'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { canOpenHqHistoryEntry, isHqHistoryTabOpen, openHqHistoryEntry } from './hq-history-open'
import { useHqChatHistory } from './use-hq-chat-history'

const DAY_TICK_MS = 60_000

function dayLabel(dayStart: number, now: number): string {
  const ago = hqHistoryDaysAgo(dayStart, now)
  if (ago === 0) {
    return translate('auto.hq.history.today', 'Today')
  }
  if (ago === 1) {
    return translate('auto.hq.history.yesterday', 'Yesterday')
  }
  return new Date(dayStart).toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long'
  })
}

function HistoryRow({
  entry,
  tabsByWorktree
}: {
  entry: HqHistoryEntry
  tabsByWorktree: Record<string, Tab[]>
}): React.JSX.Element {
  const [busy, setBusy] = useState(false)
  const open = isHqHistoryTabOpen(entry, tabsByWorktree)
  const openable = canOpenHqHistoryEntry(entry, tabsByWorktree)
  const title = entry.title ?? entry.place ?? translate('auto.hq.history.untitled', 'Agent chat')
  const where = [entry.agent, entry.place].filter(Boolean).join(' · ')
  const onOpen = (): void => {
    setBusy(true)
    void openHqHistoryEntry(entry).finally(() => setBusy(false))
  }
  return (
    <li>
      <button
        type="button"
        disabled={!openable || busy}
        onClick={onOpen}
        className="flex w-full flex-col gap-0.5 rounded-md px-2.5 py-2 text-left hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none disabled:cursor-default disabled:hover:bg-transparent"
      >
        <span className="flex items-baseline gap-2">
          <span className="min-w-0 flex-1 truncate text-[13px] font-medium" title={title}>
            {title}
          </span>
          <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
            {new Date(entry.finishedAt).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit'
            })}
          </span>
        </span>
        <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className="min-w-0 truncate">{where}</span>
          {entry.finishes > 1 ? (
            <span className="shrink-0">
              {translate('auto.hq.history.turns', '· {{count}} turns', { count: entry.finishes })}
            </span>
          ) : null}
          {open ? null : (
            <Badge variant="outline" className="shrink-0">
              {openable
                ? translate('auto.hq.history.closed', 'Closed')
                : translate('auto.hq.history.gone', 'Terminal closed')}
            </Badge>
          )}
        </span>
        {entry.lastMessage ? (
          <span className="line-clamp-2 text-xs text-muted-foreground">{entry.lastMessage}</span>
        ) : null}
      </button>
    </li>
  )
}

export function HqHistoryTab(): React.JSX.Element {
  const now = useNow(DAY_TICK_MS)
  const history = useHqChatHistory()
  const tabsByWorktree = useAppStore((state) => state.unifiedTabsByWorktree)
  const days = useMemo(
    () => (history.status === 'ready' ? groupHqChatHistoryByDay(history.entries) : []),
    [history]
  )
  return (
    <div className="scrollbar-sleek flex h-full min-h-0 flex-col gap-3 overflow-y-auto p-4">
      <p className="text-xs text-muted-foreground">
        {translate(
          'auto.hq.history.hint',
          'Agent chats that finished over the last week, closed ones included. Click one to open it here.'
        )}
      </p>
      {history.status === 'error' ? (
        <p className="text-xs text-destructive">{history.message}</p>
      ) : null}
      {history.status === 'ready' && days.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {translate('auto.hq.history.empty', 'No agent chats finished this week.')}
        </p>
      ) : null}
      {days.map((day) => (
        <section key={day.dayStart} aria-label={dayLabel(day.dayStart, now)}>
          <h3 className="px-2.5 pb-1 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
            {dayLabel(day.dayStart, now)}
          </h3>
          <ul className="flex flex-col gap-px">
            {day.entries.map((entry) => (
              <HistoryRow key={entry.key} entry={entry} tabsByWorktree={tabsByWorktree} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
