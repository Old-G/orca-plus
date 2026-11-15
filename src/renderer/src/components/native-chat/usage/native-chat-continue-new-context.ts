// Custom build (chat-continue-new, T6): what the composer's context ring needs to offer a fresh chat.
// Kept apart from the hook so the ring does not pull in the launch's runtime imports.
import { createContext, useContext } from 'react'

export type NativeChatContinueNew = {
  usedTokens: number
  idleMs: number
  starting: boolean
  /** Resolves true once the new chat is up; `message` goes to it first, after the saved context. */
  start: (message?: string) => Promise<boolean>
}

/** Null unless this chat is due; the composer's context ring reads it. */
export const NativeChatContinueNewContext = createContext<NativeChatContinueNew | null>(null)

export function useNativeChatContinueNewOffer(): NativeChatContinueNew | null {
  return useContext(NativeChatContinueNewContext)
}
