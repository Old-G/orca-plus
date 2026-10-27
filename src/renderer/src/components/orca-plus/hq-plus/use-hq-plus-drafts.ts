// Custom build (hq-plus-drafts): chats the owner wrote in and left unsent on purpose — waiting for
// more to add before sending — listed above the others so none is forgotten.
import { useMemo, useSyncExternalStore } from 'react'
import {
  listNativeChatComposerDrafts,
  nativeChatDraftScopeTabId,
  structuredAgentSessionIdOfDraftScope,
  subscribeToNativeChatComposerDrafts
} from '../../native-chat/native-chat-composer-draft-store'
import type { HqChatItem } from '../hq/hq-chat-list'
import { hqPlusChatOfSession } from './hq-plus-chats'

export type HqPlusDraftChat = { item: HqChatItem; text: string; savedAt: number }

let version = 0
const subscribe = (listener: () => void): (() => void) =>
  subscribeToNativeChatComposerDrafts(() => {
    version += 1
    listener()
  })

/** The open chats holding an unsent draft, the newest draft first. */
export function useHqPlusDraftChats(items: readonly HqChatItem[]): HqPlusDraftChat[] {
  const seen = useSyncExternalStore(subscribe, () => version)
  return useMemo(() => {
    void seen
    const listed: HqPlusDraftChat[] = []
    const used = new Set<string>()
    for (const draft of listNativeChatComposerDrafts()) {
      const sessionId = structuredAgentSessionIdOfDraftScope(draft.scopeKey)
      const tabId = sessionId ? null : nativeChatDraftScopeTabId(draft.scopeKey)
      const item = sessionId
        ? hqPlusChatOfSession(items, sessionId)
        : (items.find((entry) => entry.kind === 'chat' && entry.tab.id === tabId) ?? null)
      if (item && !used.has(item.key)) {
        used.add(item.key)
        listed.push({ item, text: draft.text, savedAt: draft.savedAt })
      }
    }
    return listed
  }, [items, seen])
}
