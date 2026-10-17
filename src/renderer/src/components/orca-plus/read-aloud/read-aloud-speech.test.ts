// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Spoken = {
  text: string
  rate: number
  lang: string
  voice: { name: string } | null
  onend?: () => void
}
type Played = { src: string; playbackRate: number; onended?: () => void; paused: boolean }

const spoken: Spoken[] = []
const played: Played[] = []
const cancel = vi.fn()

beforeEach(() => {
  spoken.length = 0
  played.length = 0
  vi.stubGlobal(
    'SpeechSynthesisUtterance',
    class {
      text: string
      rate = 1
      lang = ''
      voice: { name: string } | null = null
      onend?: () => void
      constructor(text: string) {
        this.text = text
      }
    }
  )
  vi.stubGlobal('speechSynthesis', {
    speak: (utterance: Spoken) => spoken.push(utterance),
    cancel,
    getVoices: () => [
      { name: 'Samantha', lang: 'en-US', voiceURI: 'samantha' },
      { name: 'Milena', lang: 'ru-RU', voiceURI: 'milena' },
      { name: 'Milena (Enhanced)', lang: 'ru-RU', voiceURI: 'milena-hd' }
    ]
  })
  vi.stubGlobal(
    'Audio',
    class {
      src: string
      playbackRate = 1
      preservesPitch = false
      paused = true
      onended?: () => void
      onerror?: () => void
      onpause?: () => void
      constructor(src: string) {
        this.src = src
        played.push(this)
      }
      play(): Promise<void> {
        this.paused = false
        return Promise.resolve()
      }
      pause(): void {
        this.paused = true
        this.onpause?.()
      }
    }
  )
  vi.stubGlobal('URL', { createObjectURL: () => 'blob:x', revokeObjectURL: () => undefined })
})

afterEach(() => {
  vi.unstubAllGlobals()
  cancel.mockReset()
})

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

describe('read-aloud speech', async () => {
  const speech = await import('./read-aloud-speech')

  it('reads with a system voice in Russian, the better one first, and frees the key at the end', () => {
    const { result } = renderHook(() => speech.useReadAloudKey())
    expect(speech.russianVoices().map((voice) => voice.name)).toEqual([
      'Milena (Enhanced)',
      'Milena'
    ])
    act(() =>
      speech.startReadAloud('chat-1', 'Первое. Второе.', { rate: 2, voice: 'system:milena' })
    )
    expect(spoken[0]).toMatchObject({ rate: 2, lang: 'ru-RU', voice: { name: 'Milena' } })
    expect(result.current).toBe('chat-1')
    act(() => spoken[0].onend?.())
    expect(result.current).toBeNull()
  })

  it('plays the natural voice piece by piece, fetching the next one while the current plays', async () => {
    const synthesize = vi.fn(async (text: string, _voice: string) => new TextEncoder().encode(text))
    const long = Array.from({ length: 40 }, (_, i) => `Предложение номер ${i} про задачу.`).join(
      ' '
    )
    const { result } = renderHook(() => speech.useReadAloudKey())
    act(() => speech.startReadAloud('chat-1', long, { rate: 1.5, voice: null }, synthesize))
    await act(tick)
    expect(played).toHaveLength(1)
    expect(played[0].playbackRate).toBe(1.5)
    // The second piece is already being fetched while the first plays.
    expect(synthesize).toHaveBeenCalledTimes(2)
    expect(synthesize.mock.calls[0][1]).toBe('nova')
    act(() => speech.setReadAloudRate(2))
    expect(played[0].playbackRate).toBe(2)
    await act(async () => {
      played[0].onended?.()
      await tick()
    })
    expect(played).toHaveLength(2)
    await act(async () => {
      played[1].onended?.()
      await tick()
    })
    expect(synthesize.mock.calls.map(([text]) => text).join(' ')).toBe(long)
    expect(result.current).toBeNull()
  })

  it('falls back to the system voice for the rest when the natural one is not available', async () => {
    const synthesize = vi.fn(async () => null)
    act(() =>
      speech.startReadAloud('chat-1', 'Раз. Два.', { rate: 1, voice: 'neural:coral' }, synthesize)
    )
    await act(tick)
    expect(played).toHaveLength(0)
    expect(spoken.map((utterance) => utterance.text).join(' ')).toBe('Раз. Два.')
  })

  it('stops the previous answer when another starts; its late end changes nothing', () => {
    const { result } = renderHook(() => speech.useReadAloudKey())
    act(() => speech.startReadAloud('chat-1', 'Одно.', { rate: 1, voice: 'system:milena' }))
    const first = spoken.at(-1)
    act(() => speech.startReadAloud('chat-2', 'Другое.', { rate: 1, voice: 'system:milena' }))
    expect(cancel).toHaveBeenCalled()
    act(() => first?.onend?.())
    expect(result.current).toBe('chat-2')
    act(() => speech.stopReadAloud())
    expect(result.current).toBeNull()
  })
})
