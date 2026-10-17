// Custom build (hq-voice-prompts): with voice prompts on, a finished dictation waits here for the owner to
// pick what it becomes before anything is inserted.
import { useSyncExternalStore } from 'react'
import type { DictationInsertionTarget } from '@/components/dictation/dictation-insertion-target'
import { useAppStore } from '@/store'

export type HqVoicePreview = { text: string; target: DictationInsertionTarget | null }

let current: HqVoicePreview | null = null
const listeners = new Set<() => void>()

function publish(next: HqVoicePreview | null): void {
  current = next
  for (const listener of listeners) {
    listener()
  }
}

/** True while voice prompts are on: the dictation's text is held back for the preview. */
export function holdsHqVoicePreview(): boolean {
  return useAppStore.getState().settings?.hqVoicePromptsEnabled === true
}

/** Called when a dictation ends; opens the preview when voice prompts are on and words were heard. */
export function offerHqVoicePreview(text: string, target: DictationInsertionTarget | null): void {
  if (holdsHqVoicePreview() && text.trim()) {
    publish({ text: text.trim(), target })
  }
}

export function closeHqVoicePreview(): void {
  publish(null)
}

export function useHqVoicePreview(): HqVoicePreview | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => current
  )
}
