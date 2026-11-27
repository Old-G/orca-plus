// Custom build (hq-session-history, owner 27.11): ← / → in the Session header walk the chats opened in this
// run of the app, like a browser. Opening a chat after «back» cuts the forward branch; a chat closed since is
// skipped. Lives in memory only — a restart starts a fresh history.
import { useSyncExternalStore } from 'react'

export type HqChatHistory = {
  readonly stack: readonly string[]
  /** Position of the open chat in `stack`; -1 while empty. */
  readonly index: number
}

export const HQ_CHAT_HISTORY_LIMIT = 50

export const EMPTY_HQ_CHAT_HISTORY: HqChatHistory = { stack: [], index: -1 }

/** A chat was opened: it becomes the newest entry and drops everything forward of the current one. */
export function hqChatHistoryVisit(history: HqChatHistory, key: string): HqChatHistory {
  if (history.stack[history.index] === key) {
    return history
  }
  const stack = [...history.stack.slice(0, history.index + 1), key].slice(-HQ_CHAT_HISTORY_LIMIT)
  return { stack, index: stack.length - 1 }
}

function step(history: HqChatHistory, dir: -1 | 1, isOpen: (key: string) => boolean): number {
  const current = history.stack[history.index]
  for (let i = history.index + dir; i >= 0 && i < history.stack.length; i += dir) {
    const key = history.stack[i]
    // Why: a closed chat has nothing to show, and the same chat twice in a row would be a dead click.
    if (key !== current && isOpen(key)) {
      return i
    }
  }
  return -1
}

export function hqChatHistoryCanGo(
  history: HqChatHistory,
  dir: -1 | 1,
  isOpen: (key: string) => boolean
): boolean {
  return step(history, dir, isOpen) >= 0
}

/** Moves back (-1) or forward (1) to the nearest open chat; the same history when there is none. */
export function hqChatHistoryGo(
  history: HqChatHistory,
  dir: -1 | 1,
  isOpen: (key: string) => boolean
): HqChatHistory {
  const index = step(history, dir, isOpen)
  return index < 0 ? history : { stack: history.stack, index }
}

export function hqChatHistoryCurrent(history: HqChatHistory): string | null {
  return history.stack[history.index] ?? null
}

// One history per app run, shared by every HQ+ screen that mounts.
let state = EMPTY_HQ_CHAT_HISTORY
const listeners = new Set<() => void>()

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function setHqChatHistory(next: HqChatHistory): void {
  if (next === state) {
    return
  }
  state = next
  for (const listener of listeners) {
    listener()
  }
}

export function getHqChatHistory(): HqChatHistory {
  return state
}

export function useHqChatHistory(): HqChatHistory {
  return useSyncExternalStore(subscribe, getHqChatHistory, getHqChatHistory)
}
