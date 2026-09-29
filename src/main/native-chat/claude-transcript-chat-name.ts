// Custom build (native-chat-titles): a Claude chat is named after the title Claude itself writes into
// its transcript (`ai-title`). Written into the record's conversation name — upstream's one source for
// tabs, sidebar, HQ, notifications and the AI Vault — so every surface shows it, old chats included.
import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'
import type { AgentSessionRecord } from '../../shared/agent-session-record'
import type { AgentSessionStatusSummary } from '../../shared/agent-session-wire'
import { normalizeAgentSessionConversationName } from '../../shared/agent-session-conversation-name'
import type { AgentSessionRecordStore } from '../runtime/agent-session-record-store'
import { resolveTitleTranscriptPath } from '../ai-vault/session-title-transcript-path'

// Why: Claude writes the title a few seconds into the first turn; a summary that came too early retries.
const RETRY_AFTER_MS = 20_000

/** The last `ai-title` in a Claude transcript; null when Claude has not titled it yet. */
export async function readClaudeTranscriptAiTitle(transcriptPath: string): Promise<string | null> {
  let title: string | null = null
  const lines = createInterface({
    input: createReadStream(transcriptPath, 'utf8'),
    crlfDelay: Infinity
  })
  try {
    for await (const line of lines) {
      if (!line.includes('"ai-title"')) {
        continue
      }
      try {
        const entry: unknown = JSON.parse(line)
        const aiTitle =
          entry && typeof entry === 'object' && Reflect.get(entry, 'type') === 'ai-title'
            ? Reflect.get(entry, 'aiTitle')
            : null
        title = normalizeAgentSessionConversationName(aiTitle) ?? title
      } catch {
        // A torn last line while Claude is still writing it.
      }
    }
  } finally {
    lines.close()
  }
  return title
}

export type ClaudeTranscriptChatNameDeps = {
  getStore: () => Pick<
    AgentSessionRecordStore,
    'getRecord' | 'compareAndSetConversationName'
  > | null
  readTitle: (providerSessionId: string) => Promise<string | null>
  onNamed: (workspaceId: string, sessionId: string) => void
  now?: () => number
  warn?: (message: string, error: unknown) => void
}

function claudeProviderSessionId(record: AgentSessionRecord): string | null {
  const head = record.providerHandleChain.at(-1)?.handle
  return head?.agent === 'claude' ? head.nativeId : null
}

export function createClaudeTranscriptChatNamer(deps: ClaudeTranscriptChatNameDeps) {
  const now = deps.now ?? Date.now
  const lastTriedAt = new Map<string, number>()
  const inFlight = new Set<string>()

  async function name(sessionId: string): Promise<void> {
    const store = deps.getStore()
    const record = store?.getRecord(sessionId)
    const providerSessionId = record ? claudeProviderSessionId(record) : null
    if (!store || !record || record.conversationName !== undefined || !providerSessionId) {
      return
    }
    const title = await deps.readTitle(providerSessionId)
    if (!title) {
      return
    }
    // Why expected null: a name the user or upstream's generator already gave is never replaced.
    const named = await store.compareAndSetConversationName(sessionId, title, null)
    if (named) {
      deps.onNamed(named.location.workspaceId, sessionId)
    }
  }

  return (summary: Pick<AgentSessionStatusSummary, 'sessionId'>): void => {
    const sessionId = summary.sessionId
    const record = deps.getStore()?.getRecord(sessionId)
    const at = now()
    if (
      !record ||
      record.conversationName !== undefined ||
      inFlight.has(sessionId) ||
      at - (lastTriedAt.get(sessionId) ?? -Infinity) < RETRY_AFTER_MS
    ) {
      return
    }
    lastTriedAt.set(sessionId, at)
    inFlight.add(sessionId)
    void name(sessionId)
      .catch((error: unknown) => deps.warn?.('[native-chat-titles] naming failed', error))
      .finally(() => inFlight.delete(sessionId))
  }
}

/** The transcript title of a Claude conversation on this host. */
export async function readClaudeConversationTitle(
  providerSessionId: string
): Promise<string | null> {
  const path = await resolveTitleTranscriptPath(
    { agent: 'claude', sessionId: providerSessionId },
    undefined
  )
  return path ? readClaudeTranscriptAiTitle(path) : null
}
