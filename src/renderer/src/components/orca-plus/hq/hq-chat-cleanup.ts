// Custom build (chat-cleanup): which open native chats may close. A close is the tab's ×, so the chat
// stays reopenable from History. Nothing that works, waits for the owner or for someone's answer, is
// pinned, marked, shown, unread or looks unfinished is touched.
import type { HqChatItem } from './hq-chat-list'

export type HqChatCleanupMode = 'off' | 'report' | 'on'
// Why report first: the owner reads a day of «would close» before anything closes (22.10).
export const HQ_CHAT_CLEANUP_DEFAULT_MODE: HqChatCleanupMode = 'report'
/** A finished chat the owner already read. */
export const HQ_CHAT_CLEANUP_DONE_MS = 12 * 60 * 60_000
/** Any chat this quiet. */
export const HQ_CHAT_CLEANUP_STALE_MS = 24 * 60 * 60_000

const NATIVE_CHAT_TAB = 'structured-agent-session-'

export type HqChatCleanupReason = 'done' | 'stale'

type HqChatTabItem = Extract<HqChatItem, { kind: 'chat' }>

export type HqChatCleanupCandidate = {
  item: HqChatTabItem
  reason: HqChatCleanupReason
  quietSince: number
}

export type HqChatCleanupGuards = {
  now: number
  markedKeys: ReadonlySet<string>
  askSessionId: string | null
  /** Chats an open waiting will pass someone's answer to. */
  waitingSessionIds: ReadonlySet<string>
  /** Pane keys of HQ's deferred sessions: quiet, but their work looks unfinished. */
  unfinishedPaneKeys: ReadonlySet<string>
  /** Chats on screen (HQ's and the active workspace's), by HQ chat key. */
  shownKeys: ReadonlySet<string>
}

export function hqChatSessionId(tabId: string): string | null {
  return tabId.startsWith(NATIVE_CHAT_TAB) ? tabId.slice(NATIVE_CHAT_TAB.length) : null
}

function quietSince(item: HqChatTabItem): number {
  const card = item.card
  return Math.max(
    card?.finishedAt ?? 0,
    card?.stateChangedAt ?? 0,
    item.tab.lastFocusedAt ?? 0,
    item.tab.createdAt
  )
}

function guarded(item: HqChatTabItem, sessionId: string, guards: HqChatCleanupGuards): boolean {
  const card = item.card
  return (
    item.tab.isPinned === true ||
    item.group === 'needs' ||
    item.group === 'working' ||
    card?.unseen === true ||
    (card !== null && guards.unfinishedPaneKeys.has(card.paneKey)) ||
    guards.markedKeys.has(item.key) ||
    guards.shownKeys.has(item.key) ||
    guards.askSessionId === sessionId ||
    guards.waitingSessionIds.has(sessionId)
  )
}

/** Oldest quiet first. */
export function hqChatCleanupCandidates(
  items: readonly HqChatItem[],
  guards: HqChatCleanupGuards
): HqChatCleanupCandidate[] {
  const found: HqChatCleanupCandidate[] = []
  for (const item of items) {
    const sessionId = item.kind === 'chat' ? hqChatSessionId(item.tab.id) : null
    if (item.kind !== 'chat' || !sessionId || guarded(item, sessionId, guards)) {
      continue
    }
    const since = quietSince(item)
    const quiet = guards.now - since
    const reason: HqChatCleanupReason | null =
      item.card?.dotState === 'done' && quiet >= HQ_CHAT_CLEANUP_DONE_MS
        ? 'done'
        : quiet >= HQ_CHAT_CLEANUP_STALE_MS
          ? 'stale'
          : null
    if (reason) {
      found.push({ item, reason, quietSince: since })
    }
  }
  return found.sort((a, b) => a.quietSince - b.quietSince)
}

function quietLabel(ms: number): string {
  const hours = Math.floor(ms / (60 * 60_000))
  return hours >= 48 ? `${Math.floor(hours / 24)} дн.` : `${hours} ч`
}

/** The day's report in HQ Reports: what closed, or in report mode what would. */
export function hqChatCleanupReport(
  candidates: readonly HqChatCleanupCandidate[],
  options: { mode: HqChatCleanupMode; now: number; title: (item: HqChatTabItem) => string }
): string {
  const day = new Date(options.now)
  const date = `${String(day.getDate()).padStart(2, '0')}.${String(day.getMonth() + 1).padStart(2, '0')}`
  const trial = options.mode === 'report'
  const lines = [
    `# Чистка чатов — ${date}${trial ? ' (пробный прогон)' : ''}`,
    '',
    trial
      ? `Закрыла бы ${candidates.length} чатов. Закрытие — как крестик на вкладке: чат остаётся в History и открывается снова. Ничего не закрыто. Если список верный — включи в Settings → Workspace → «Close quiet chats» значение On.`
      : `Закрыто ${candidates.length} чатов — как крестиком; каждый открывается снова из History.`,
    ''
  ]
  const byProject = new Map<string, HqChatCleanupCandidate[]>()
  for (const candidate of candidates) {
    const name = candidate.item.projectName
    byProject.set(name, [...(byProject.get(name) ?? []), candidate])
  }
  for (const [project, list] of byProject) {
    lines.push(`## ${project} · ${list.length}`, '')
    for (const { item, reason, quietSince: since } of list) {
      const why =
        reason === 'done'
          ? `готов и прочитан, тихо ${quietLabel(options.now - since)}`
          : `тихо ${quietLabel(options.now - since)}`
      lines.push(`- «${options.title(item)}» — ${why}`)
    }
    lines.push('')
  }
  return lines.join('\n')
}
