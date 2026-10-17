// Custom build (hq-read-aloud): one voice for the whole app — starting another answer stops the first.
// The system's own voices (Web Speech), so nothing leaves the Mac.
import { useSyncExternalStore } from 'react'
import { speechChunks } from './read-aloud-text'

export const READ_ALOUD_RATES = [1, 1.25, 1.5, 1.75, 2, 2.5, 3] as const
export const READ_ALOUD_LANG = 'ru-RU'

let speakingKey: string | null = null
let generation = 0
const listeners = new Set<() => void>()

function publish(next: string | null): void {
  speakingKey = next
  for (const listener of listeners) {
    listener()
  }
}

function synth(): SpeechSynthesis | null {
  return typeof window !== 'undefined' && 'speechSynthesis' in window
    ? window.speechSynthesis
    : null
}

export function readAloudAvailable(): boolean {
  return synth() !== null
}

/** Russian voices, the downloaded higher-quality ones first. */
export function russianVoices(): SpeechSynthesisVoice[] {
  const voices = synth()?.getVoices() ?? []
  return voices
    .filter((voice) => voice.lang.toLowerCase().startsWith('ru'))
    .sort(
      (a, b) =>
        Number(/enhanced|premium|улучш/i.test(b.name)) -
        Number(/enhanced|premium|улучш/i.test(a.name))
    )
}

export function stopReadAloud(): void {
  generation += 1
  synth()?.cancel()
  publish(null)
}

/** Reads `text` for the chat `key`; a voice URI that is gone falls back to the best Russian one. */
export function startReadAloud(
  key: string,
  text: string,
  options: { rate: number; voiceURI: string | null }
): void {
  const speech = synth()
  stopReadAloud()
  const chunks = speechChunks(text)
  if (!speech || chunks.length === 0) {
    return
  }
  const voices = russianVoices()
  const voice = voices.find((entry) => entry.voiceURI === options.voiceURI) ?? voices[0] ?? null
  const mine = generation
  chunks.forEach((chunk, index) => {
    const utterance = new SpeechSynthesisUtterance(chunk)
    utterance.lang = READ_ALOUD_LANG
    utterance.rate = options.rate
    if (voice) {
      utterance.voice = voice
    }
    if (index === chunks.length - 1) {
      utterance.onend = () => mine === generation && publish(null)
    }
    utterance.onerror = () => mine === generation && publish(null)
    speech.speak(utterance)
  })
  publish(key)
}

/** The chat being read aloud now, or null. */
export function useReadAloudKey(): string | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => speakingKey
  )
}
