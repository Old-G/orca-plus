// Custom build (hq-feed-history): an agent-session post opens its chat, as History's rows did — the
// post's id names the bell's agent-finished item, which holds the chat's pane.
import { buildHqChatHistory, readHqHistorySource } from '../../../../../shared/hq-chat-history'
import type { HqFeedItem } from '../../../../../shared/hq-feed'
import { PULSE_BELL_KIND } from '../../../../../shared/pulse-bell'
import { structuredSessionOpenFeedback } from '@/lib/activate-ai-vault-structured-session'
import { openHqHistoryEntry } from './hq-history-open'

const SESSION_PREFIX = 'session:'

export function isHqFeedSession(item: Pick<HqFeedItem, 'id' | 'kind'>): boolean {
  return item.kind === 'session' && item.id.startsWith(SESSION_PREFIX)
}

export async function openHqFeedSessionChat(item: Pick<HqFeedItem, 'id' | 'at'>): Promise<void> {
  const inboxId = item.id.slice(SESSION_PREFIX.length)
  const response = await window.api.runtime.call({
    method: 'pulse.listInbox',
    params: { includeDone: true, kind: PULSE_BELL_KIND.agentFinished, since: item.at - 1 }
  })
  const raw: unknown[] = response.ok && Array.isArray(response.result) ? response.result : []
  const finished = raw.filter(
    (entry) => entry && typeof entry === 'object' && Reflect.get(entry, 'id') === inboxId
  )
  const [entry] = buildHqChatHistory(readHqHistorySource(finished), Date.now())
  if (!entry) {
    structuredSessionOpenFeedback.unavailable()
    return
  }
  await openHqHistoryEntry(entry)
}
