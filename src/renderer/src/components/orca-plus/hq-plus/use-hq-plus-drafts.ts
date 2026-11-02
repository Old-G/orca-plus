// Custom build (hq-plus-drafts): chats the owner wrote in and left unsent on purpose — waiting for
// more to add before sending — listed above the others so none is forgotten.
import { useMemo, useSyncExternalStore } from 'react'
import {
  listNativeChatComposerDrafts,
  nativeChatDraftScopeTabId,
  structuredAgentSessionIdOfDraftScope,
  subscribeToNativeChatComposerDrafts
} from '../../native-chat/native-chat-composer-draft-store'
import { hqChatTabId, type HqChatItem } from '../hq/hq-chat-list'
import { hqPlusChatOfSession } from './hq-plus-chats'
import {
  listHqPlusTerminalDrafts,
  subscribeToHqPlusTerminalDrafts
} from './hq-plus-terminal-drafts'

export type HqPlusDraftChat = { item: HqChatItem; text: string; savedAt: number }

let version = 0
const subscribe = (listener: () => void): (() => void) => {
  const changed = (): void => {
    version += 1
    listener()
  }
  const offChat = subscribeToNativeChatComposerDrafts(changed)
  // Custom build (hq-plus-terminal-drafts): words left in a terminal agent's own input box count too.
  const offTerminal = subscribeToHqPlusTerminalDrafts(changed)
  return () => {
    offChat()
    offTerminal()
  }
}

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
    for (const draft of listHqPlusTerminalDrafts()) {
      const tabId = draft.paneKey.split(':')[0]
      // A terminal pane names its terminal tab, which the chat list holds as the Orca tab's entity.
      const item =
        items.find((entry) =>
          entry.kind === 'chat' ? entry.tab.entityId === tabId : hqChatTabId(entry) === tabId
        ) ?? null
      if (item && !used.has(item.key)) {
        used.add(item.key)
        listed.push({ item, text: draft.text, savedAt: draft.savedAt })
      }
    }
    return listed.sort((a, b) => b.savedAt - a.savedAt)
  }, [items, seen])
}
