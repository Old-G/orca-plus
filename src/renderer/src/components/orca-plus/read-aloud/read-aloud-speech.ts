// Custom build (hq-read-aloud): one voice for the whole app — starting another answer stops the first.
// A natural OpenAI voice when the Mac has Orca's OpenAI key (the next piece is fetched while the current
// one plays, so the reading has no gaps); otherwise, or when that fails, the system's own voice.
import { useSyncExternalStore } from 'react'
import {
  HQ_READ_ALOUD_NEURAL_VOICES,
  type HqReadAloudNeuralVoice
} from '../../../../../shared/hq-read-aloud'
import { speechChunks } from './read-aloud-text'

export const READ_ALOUD_RATES = [1, 1.25, 1.5, 1.75, 2, 2.5, 3] as const
export const READ_ALOUD_LANG = 'ru-RU'
/** Stored voice choice: `neural:<voice>` or `system:<voiceURI>`; null is the default natural voice. */
export const DEFAULT_READ_ALOUD_VOICE = 'neural:nova'

const SYSTEM_CHUNK = 240
// Why: well under the speech API's 4096-character input, and short enough that the first piece starts fast.
const NEURAL_FIRST_CHUNK = 400
const NEURAL_CHUNK = 1500

let speakingKey: string | null = null
let generation = 0
let currentAudio: HTMLAudioElement | null = null
let currentRate = 1
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
  return synth() !== null || typeof Audio !== 'undefined'
}

export function neuralVoice(choice: string | null): HqReadAloudNeuralVoice | null {
  const value = (choice ?? DEFAULT_READ_ALOUD_VOICE).replace(/^neural:/, '')
  return choice?.startsWith('system:')
    ? null
    : (HQ_READ_ALOUD_NEURAL_VOICES.find((voice) => voice === value) ?? 'nova')
}

/** Russian system voices, the downloaded higher-quality ones first. */
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
  currentAudio?.pause()
  currentAudio = null
  publish(null)
}

/** Changes the speed of what is being read now, and of what comes next. */
export function setReadAloudRate(rate: number): void {
  currentRate = rate
  if (currentAudio) {
    currentAudio.playbackRate = rate
  }
}

function speakSystem(text: string, voiceURI: string | null, mine: number): void {
  const speech = synth()
  const chunks = speechChunks(text, SYSTEM_CHUNK)
  if (!speech || chunks.length === 0) {
    publish(null)
    return
  }
  const voices = russianVoices()
  const voice = voices.find((entry) => entry.voiceURI === voiceURI) ?? voices[0] ?? null
  chunks.forEach((chunk, index) => {
    const utterance = new SpeechSynthesisUtterance(chunk)
    utterance.lang = READ_ALOUD_LANG
    utterance.rate = currentRate
    if (voice) {
      utterance.voice = voice
    }
    if (index === chunks.length - 1) {
      utterance.onend = () => mine === generation && publish(null)
    }
    utterance.onerror = () => mine === generation && publish(null)
    speech.speak(utterance)
  })
}

type Synthesize = (text: string, voice: HqReadAloudNeuralVoice) => Promise<Uint8Array | null>

const synthesizeOnMac: Synthesize = async (text, voice) => {
  const result = await window.api.hqProjects.readAloudSpeech({ text, voice }).catch(() => null)
  return result?.ok ? result.audio : null
}

function neuralPieces(text: string): string[] {
  const [first = '', ...rest] = speechChunks(text, NEURAL_FIRST_CHUNK)
  return first ? [first, ...speechChunks(rest.join(' '), NEURAL_CHUNK)] : []
}

function play(audio: Uint8Array, mine: number): Promise<boolean> {
  return new Promise((resolve) => {
    // Why: copied into a fresh ArrayBuffer — a Blob cannot take a view over shared memory.
    const url = URL.createObjectURL(new Blob([audio.slice()], { type: 'audio/mpeg' }))
    const element = new Audio(url)
    element.preservesPitch = true
    element.playbackRate = currentRate
    currentAudio = element
    const done = (finished: boolean): void => {
      URL.revokeObjectURL(url)
      resolve(finished && mine === generation)
    }
    element.onended = () => done(true)
    element.onerror = () => done(false)
    element.onpause = () => {
      if (mine !== generation) {
        done(false)
      }
    }
    void element.play().catch(() => done(false))
  })
}

async function speakNeural(
  text: string,
  voice: HqReadAloudNeuralVoice,
  mine: number,
  synthesize: Synthesize
): Promise<void> {
  const pieces = neuralPieces(text)
  let next = pieces.length > 0 ? synthesize(pieces[0], voice) : Promise.resolve(null)
  for (let index = 0; index < pieces.length; index += 1) {
    const audio = await next
    if (mine !== generation) {
      return
    }
    if (!audio) {
      // Why: no key, offline or refused — the rest is read by the system voice rather than dropped.
      speakSystem(pieces.slice(index).join(' '), null, mine)
      return
    }
    next = index + 1 < pieces.length ? synthesize(pieces[index + 1], voice) : Promise.resolve(null)
    if (!(await play(audio, mine))) {
      if (mine === generation) {
        publish(null)
      }
      return
    }
  }
  if (mine === generation) {
    currentAudio = null
    publish(null)
  }
}

/** Reads `text` for the chat `key` with the chosen voice (see DEFAULT_READ_ALOUD_VOICE). */
export function startReadAloud(
  key: string,
  text: string,
  options: { rate: number; voice: string | null },
  synthesize: Synthesize = synthesizeOnMac
): void {
  stopReadAloud()
  if (!text.trim()) {
    return
  }
  currentRate = options.rate
  const mine = generation
  publish(key)
  const neural = neuralVoice(options.voice)
  if (neural) {
    void speakNeural(text, neural, mine, synthesize)
  } else {
    speakSystem(text, options.voice?.replace(/^system:/, '') ?? null, mine)
  }
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
