// Custom build (hq-chats): which chat HQ opens on, and opening a chat in HQ from elsewhere.
import { useAppStore } from '@/store'
import { hqChatKey } from './hq-chat-list'
import { openHqScreen } from './hq-view'

let rememberedKey: string | null = null
let shown: { worktreeId: string; tabId: string } | null = null

export function rememberedHqChat(): string | null {
  return rememberedKey
}

export function rememberHqChat(key: string | null): void {
  rememberedKey = key
}

export function setShownHqChatTab(tab: { worktreeId: string; tabId: string } | null): void {
  shown = tab
}

/** The chat is open on HQ's screen right now, so news of it needs no toast. */
export function isHqChatShown(worktreeId: string, tabId: string): boolean {
  return (
    useAppStore.getState().activeView === 'hq' &&
    shown?.worktreeId === worktreeId &&
    shown.tabId === tabId
  )
}

/** HQ opened on one chat: remembered first, so an open HQ switches to it as a new one starts on it. */
export function openHqChat(key: string): void {
  rememberHqChat(key)
  openHqScreen('chats')
}

/** With HQ's messenger in front, a chat asked for elsewhere (a toast, a notification, a new session)
 *  opens in HQ instead of pulling the user into its project. */
export function openChatInShownHq(worktreeId: string, tabId: string | null | undefined): boolean {
  const { activeView, settings } = useAppStore.getState()
  if (activeView !== 'hq' || settings?.hqChatsView === false || !tabId) {
    return false
  }
  openHqChat(hqChatKey(worktreeId, tabId))
  return true
}
