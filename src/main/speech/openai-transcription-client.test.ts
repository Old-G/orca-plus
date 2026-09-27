import { describe, expect, it, vi } from 'vitest'
import { dictationLanguageCode } from '../../shared/speech-types'
import {
  OpenAiTranscriptionSession,
  sanitizeOpenAiTranscriptionErrorMessage
} from './openai-transcription-client'

describe('sanitizeOpenAiTranscriptionErrorMessage', () => {
  it('does not expose the invalid OpenAI API key echoed by the provider', () => {
    expect(
      sanitizeOpenAiTranscriptionErrorMessage(
        'Incorrect API key provided: fsdfdsfsdf. You can find your API key at https://platform.openai.com/account/api-keys.'
      )
    ).toBe('Incorrect OpenAI API key provided.')
  })

  it('redacts API keys and bearer tokens from other provider errors', () => {
    expect(
      sanitizeOpenAiTranscriptionErrorMessage(
        'Request failed for sk-testSecret123 with Authorization: Bearer token-value_123'
      )
    ).toBe('Request failed for [redacted] with Authorization: Bearer [redacted]')
  })
})

describe('OpenAiTranscriptionSession language', () => {
  async function sentForm(readLanguage?: () => string | undefined): Promise<FormData> {
    const fetchMock = vi.fn(
      async (_url: string, _init: RequestInit) => new Response(JSON.stringify({ text: 'привет' }))
    )
    vi.stubGlobal('fetch', fetchMock)
    try {
      const session = new OpenAiTranscriptionSession(
        'openai-gpt-4o-transcribe',
        () => 'sk-test',
        readLanguage
      )
      session.feedAudio(new Float32Array(1600), 16000)
      await expect(session.finish()).resolves.toBe('привет')
      const body = fetchMock.mock.calls[0]?.[1].body
      if (!(body instanceof FormData)) {
        throw new Error('expected a multipart body')
      }
      return body
    } finally {
      vi.unstubAllGlobals()
    }
  }

  it('sends the chosen language to OpenAI', async () => {
    expect((await sentForm(() => 'ru')).get('language')).toBe('ru')
  })

  it('leaves the language out for auto-detect', async () => {
    expect((await sentForm(() => undefined)).has('language')).toBe(false)
    expect((await sentForm()).has('language')).toBe(false)
  })
})

describe('dictationLanguageCode', () => {
  it('maps only explicit choices to a code', () => {
    expect(dictationLanguageCode('ru')).toBe('ru')
    expect(dictationLanguageCode('en')).toBe('en')
    expect(dictationLanguageCode('auto')).toBeUndefined()
    expect(dictationLanguageCode(undefined)).toBeUndefined()
  })
})
