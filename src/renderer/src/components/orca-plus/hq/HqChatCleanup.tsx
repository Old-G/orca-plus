// Custom build (chat-cleanup): every half hour finds the open native chats that may close
// (hq-chat-cleanup) and, by the owner's setting, only reports them in HQ Reports or closes them
// like the tab's ×. Renders nothing; lives at the app root.
import { useEffect, useMemo, useRef } from 'react'
import { isWebClientLocation } from '@/lib/web-client-location'
import { useAppStore } from '@/store'
import { resolveRuntimePath } from '../../../../../shared/cross-platform-path'
import { resolveAgentSessionTabTitle } from '../../tab-bar/tab-bar-item-model'
import {
  HQ_CHAT_CLEANUP_DEFAULT_MODE,
  hqChatCleanupCandidates,
  hqChatCleanupReport,
  hqChatSessionId,
  type HqChatCleanupCandidate
} from './hq-chat-cleanup'
import { hqChatKey } from './hq-chat-list'
import { isHqChatShown } from './hq-chat-open'
import { useHqChatList } from './use-hq-chat-list'
import { useHqDeferredSessions } from './use-hq-deferred-sessions'
import { useHqPulse } from './use-hq-pulse'

const SWEEP_MS = 30 * 60_000
// Why a wait: right after launch the board and the tabs are still filling in.
const FIRST_SWEEP_MS = 3 * 60_000
const NO_KEYS: string[] = []

function dayStamp(now: number): string {
  const day = new Date(now)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`
}

/** Chats in view in the active workspace's tab groups. */
function visibleChatKeys(): Set<string> {
  const state = useAppStore.getState()
  const keys = new Set<string>()
  const worktreeId = state.activeWorktreeId
  if (worktreeId && state.activeView !== 'hq') {
    for (const group of state.groupsByWorktree[worktreeId] ?? []) {
      if (group.activeTabId) {
        keys.add(hqChatKey(worktreeId, group.activeTabId))
      }
    }
  }
  return keys
}

function Cleanup(): null {
  const { items, cards } = useHqChatList()
  const { sessions: deferred } = useHqDeferredSessions(cards)
  const pulse = useHqPulse()
  const mode = useAppStore((s) => s.settings?.hqChatCleanup) ?? HQ_CHAT_CLEANUP_DEFAULT_MODE
  const hqPath = useAppStore((s) => s.settings?.hqPath ?? null)
  const marked = useAppStore((s) => s.settings?.hqMarkedChatKeys) ?? NO_KEYS
  const askSessionId = useAppStore((s) => s.settings?.hqAskSessionId ?? null)
  const generatedTitles = useAppStore((s) => s.settings?.tabAutoGenerateTitle === true)
  const waitingSessionIds = useMemo(
    () =>
      new Set(
        pulse.status === 'ready'
          ? pulse.pulse.waitings.flatMap((w) => (w.agentSessionId ? [w.agentSessionId] : []))
          : []
      ),
    [pulse]
  )
  const latest = useRef({ items, deferred, waitingSessionIds, marked, askSessionId, ready: false })
  latest.current = {
    items,
    deferred,
    waitingSessionIds,
    marked,
    askSessionId,
    // Why: without the waitings a chat that awaits someone's answer would look free to close.
    ready: pulse.status === 'ready'
  }
  const closedToday = useRef<{ day: string; closed: HqChatCleanupCandidate[] }>({
    day: '',
    closed: []
  })
  // Why: each rewrite of a report raises it in HQ again; an unchanged list is not news.
  const lastReport = useRef('')

  useEffect(() => {
    if (mode === 'off' || !hqPath) {
      return
    }
    const sweep = async (): Promise<void> => {
      const now = Date.now()
      const current = latest.current
      if (!current.ready) {
        return
      }
      const shownKeys = visibleChatKeys()
      const found = hqChatCleanupCandidates(current.items, {
        now,
        markedKeys: new Set(current.marked),
        askSessionId: current.askSessionId,
        waitingSessionIds: current.waitingSessionIds,
        unfinishedPaneKeys: new Set(current.deferred.map((session) => session.card.paneKey)),
        shownKeys
      }).filter(({ item }) => !isHqChatShown(item.worktreeId, item.tab.id))
      const day = dayStamp(now)
      if (closedToday.current.day !== day) {
        closedToday.current = { day, closed: [] }
      }
      const closed: HqChatCleanupCandidate[] = []
      if (mode === 'on') {
        for (const candidate of found) {
          // Custom build (hq-plus-sessions): a chat whose last turn is not in the journal stays open.
          const sessionId = hqChatSessionId(candidate.item.tab.id)
          const allowed = sessionId
            ? await window.api.hqProjects.mayCloseChat?.({ sessionId }).catch(() => null)
            : null
          if (allowed && !allowed.ok) {
            continue
          }
          useAppStore.getState().closeUnifiedTab(candidate.item.tab.id, {
            preserveWorktreeSelection: true
          })
          closed.push(candidate)
        }
        closedToday.current.closed.push(...closed)
      }
      const listed = mode === 'on' ? closedToday.current.closed : found
      if (listed.length === 0 || (mode === 'on' && closed.length === 0)) {
        return
      }
      const content = hqChatCleanupReport(listed, {
        mode,
        now,
        title: (item) => resolveAgentSessionTabTitle(item.tab, null, generatedTitles)
      })
      // Why the mode: «would close» and «closed» over the same chats are different news.
      const fingerprint = `${day}\n${mode}\n${listed.map(({ item }) => item.key).join('\n')}`
      if (fingerprint === lastReport.current) {
        return
      }
      lastReport.current = fingerprint
      await window.api.fs.writeFile({
        filePath: resolveRuntimePath(hqPath, `updates/chat-cleanup-${day}.md`),
        content
      })
    }
    const run = (): void => {
      void sweep().catch((error: unknown) => console.warn('[chat-cleanup] sweep failed:', error))
    }
    const first = setTimeout(run, FIRST_SWEEP_MS)
    const timer = setInterval(run, SWEEP_MS)
    return () => {
      clearTimeout(first)
      clearInterval(timer)
    }
  }, [mode, hqPath, generatedTitles])
  return null
}

export function HqChatCleanup(): React.JSX.Element | null {
  // Why: a paired web client is a reader; only the Mac's own window closes its tabs.
  return isWebClientLocation() ? null : <Cleanup />
}
