// Custom build (hq-agent-map): a native chat's agent map, read from the session HQ already shows.
// Terminal agents report no subagents, so theirs stays empty.
import { useEffect, useMemo, useSyncExternalStore } from 'react'
import {
  structuredAgentSessionOwnerForTab,
  structuredAgentSessionTargetForHost
} from '@/runtime/structured-agent-session-owner'
import { useAppStore } from '@/store'
import { getStructuredAgentSessionReadOwner } from '../../native-chat/structured-agent-session-read-owner'
import { buildHqAgentMap, NO_HQ_AGENT_MAP, type HqAgentMap } from './hq-agent-map'
import type { HqChatItem } from './hq-chat-list'

const noSubscription = (): (() => void) => () => {}

export function useHqAgentMap(item: HqChatItem): HqAgentMap {
  const tab = item.kind === 'chat' ? item.tab : null
  const owner = useAppStore((state) => (tab ? structuredAgentSessionOwnerForTab(state, tab) : null))
  const target = useMemo(() => structuredAgentSessionTargetForHost(owner), [owner])
  const sessionId = tab?.entityId ?? null
  // Why: keyed on the session, not the tab object — a rebuilt list must not restart the read.
  const reader = useMemo(
    () => (sessionId && target ? getStructuredAgentSessionReadOwner(sessionId, target) : null),
    [sessionId, target]
  )
  useEffect(() => reader?.activate(), [reader])
  const snapshot = useSyncExternalStore(
    reader?.subscribe ?? noSubscription,
    () => reader?.getSnapshot() ?? null,
    () => null
  )
  const roster = snapshot?.state.subagentRoster
  const items = snapshot?.state.items
  return useMemo(
    () => (roster && items ? buildHqAgentMap(roster, items) : NO_HQ_AGENT_MAP),
    [roster, items]
  )
}
