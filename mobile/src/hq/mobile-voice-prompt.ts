// Custom build (hq-voice-prompts): with the Mac's Voice Prompts on, a phone dictation waits here for
// the owner to pick what it becomes; off, or on an older Mac, it is inserted as before.
import { useSyncExternalStore } from 'react'
import { runRpcOperation } from '../transport/rpc-operation'
import type { RpcClient } from '../transport/rpc-client'
import { hqSettingsRead } from './hq-operations'

export type MobileVoicePrompt = { text: string; insert: (text: string) => void }

let current: MobileVoicePrompt | null = null
const listeners = new Set<() => void>()

function publish(next: MobileVoicePrompt | null): void {
  current = next
  for (const listener of listeners) {
    listener()
  }
}

async function voicePromptsOn(client: RpcClient): Promise<boolean> {
  try {
    return (await runRpcOperation(client, hqSettingsRead)).hqVoicePromptsEnabled === true
  } catch {
    return false
  }
}

/** Opens the voice prompt when the Mac has it on; otherwise inserts the transcript right away. */
export async function offerMobileVoicePrompt(
  client: RpcClient | null,
  text: string,
  insert: (text: string) => void
): Promise<void> {
  if (client && text.trim() && (await voicePromptsOn(client))) {
    publish({ text: text.trim(), insert })
    return
  }
  insert(text)
}

export function closeMobileVoicePrompt(): void {
  publish(null)
}

export function useMobileVoicePrompt(): MobileVoicePrompt | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => current
  )
}
