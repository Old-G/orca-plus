// Custom build (code-chat): the «Chat» tab of the right sidebar in the Code mode — which of a
// workspace's agent chats it shows, and opening it on one.
import { useSyncExternalStore } from 'react'
import { pluginPanelTabKey } from '../../../../../shared/plugins/plugin-tab-key'
import { useAppStore } from '@/store'

/** Keyed like a plugin panel so the sidebar route crosses the UI wire to hosts of any version. */
export const CODE_CHAT_TAB = pluginPanelTabKey('orca-plus.code', 'chat')

const chosenByWorktree = new Map<string, string>()
const listeners = new Set<() => void>()
let version = 0

function changed(): void {
  version += 1
  for (const listener of listeners) {
    listener()
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function chosenCodeChat(worktreeId: string): string | null {
  return chosenByWorktree.get(worktreeId) ?? null
}

export function chooseCodeChat(worktreeId: string, key: string): void {
  if (chosenByWorktree.get(worktreeId) === key) {
    return
  }
  chosenByWorktree.set(worktreeId, key)
  changed()
}

/** Re-renders on every choice; read the choice itself with chosenCodeChat. */
export function useCodeChatChoices(): number {
  return useSyncExternalStore(subscribe, () => version)
}

/** The right sidebar opened on the Chat tab, showing this chat of the workspace. */
export function openCodeChat(worktreeId: string, key: string): void {
  chooseCodeChat(worktreeId, key)
  const { setRightSidebarOpen, setRightSidebarTab } = useAppStore.getState()
  setRightSidebarTab(CODE_CHAT_TAB)
  setRightSidebarOpen(true)
}
