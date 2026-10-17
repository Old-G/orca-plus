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

const spoken: Spoken[] = []
const cancel = vi.fn()

beforeEach(() => {
  spoken.length = 0
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
})

afterEach(() => {
  vi.unstubAllGlobals()
  cancel.mockReset()
})

describe('read-aloud speech', async () => {
  const speech = await import('./read-aloud-speech')

  it('reads in Russian with the better voice first, and frees the key when the last piece ends', () => {
    expect(speech.russianVoices().map((voice) => voice.name)).toEqual([
      'Milena (Enhanced)',
      'Milena'
    ])
    speech.startReadAloud('chat-1', 'Первое. Второе.', { rate: 2, voiceURI: null })
    expect(spoken).toHaveLength(1)
    expect(spoken[0]).toMatchObject({
      rate: 2,
      lang: 'ru-RU',
      voice: { name: 'Milena (Enhanced)' }
    })
    spoken[0].onend?.()
    speech.startReadAloud('chat-1', 'Снова.', { rate: 1, voiceURI: 'milena' })
    expect(spoken[1].voice?.name).toBe('Milena')
  })

  it('stops the previous answer when another starts; its late end changes nothing', () => {
    const { result } = renderHook(() => speech.useReadAloudKey())
    act(() => speech.startReadAloud('chat-1', 'Одно.', { rate: 1, voiceURI: null }))
    const first = spoken.at(-1)
    act(() => speech.startReadAloud('chat-2', 'Другое.', { rate: 1, voiceURI: null }))
    expect(cancel).toHaveBeenCalled()
    act(() => first?.onend?.())
    expect(result.current).toBe('chat-2')
    act(() => speech.stopReadAloud())
    expect(result.current).toBeNull()
  })
})
