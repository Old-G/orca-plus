import { afterEach, describe, expect, it, vi } from 'vitest'
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

describe('OpenAiTranscriptionSession', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('preserves multipart WAV bytes across owned, resampled and empty audio chunks', async () => {
    const uploads: Buffer[] = []
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      expect(url).toBe('https://api.openai.com/v1/audio/transcriptions')
      expect(init.method).toBe('POST')
      expect(init.headers).toEqual({ Authorization: 'Bearer test-key' })
      const form = init.body
      if (!(form instanceof FormData)) {
        throw new Error('Expected multipart body')
      }
      expect(form.get('model')).toBe('gpt-4o-mini-transcribe')
      expect(form.get('response_format')).toBe('json')
      const file = form.get('file')
      if (!(file instanceof File)) {
        throw new Error('Expected WAV upload')
      }
      expect(file.name).toBe('dictation.wav')
      expect(file.type).toBe('audio/wav')
      uploads.push(Buffer.from(await file.arrayBuffer()))
      return new Response(JSON.stringify({ text: ' complete dictation ' }))
    })
    const session = new OpenAiTranscriptionSession(
      'openai-gpt-4o-mini-transcribe',
      () => 'test-key'
    )
    const input = new Float32Array([
      -2,
      -1,
      -0.5,
      -1 / 65536,
      0,
      0.5,
      1,
      2,
      Number.NaN,
      Infinity,
      -Infinity
    ])
    session.feedAudio(input, 16000)
    input.fill(0)
    session.feedAudio(new Float32Array(), 16000)
    session.feedAudio(new Float32Array([0, 0.25, 0.5, 0.75, 1, 1.25]), 48000)
    expect(await session.finish()).toBe('complete dictation')
    expect(await session.finish()).toBe('')
    expect(uploads).toHaveLength(1)
    const wav = uploads[0]
    expect(wav.subarray(0, 44).toString('hex')).toBe(
      '524946463e00000057415645666d74201000000001000100803e0000007d000002001000646174611a000000'
    )
    expect(Array.from({ length: 13 }, (_, i) => wav.readInt16LE(44 + i * 2))).toEqual([
      -32768, -32768, -16384, 0, 0, 16384, 32767, 32767, 0, 32767, -32768, 0, 24575
    ])
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

describe('OpenAiTranscriptionSession network failures', () => {
  function networkError(code: string): TypeError {
    return new TypeError('fetch failed', { cause: Object.assign(new Error('socket'), { code }) })
  }

  async function finishWith(fetchMock: ReturnType<typeof vi.fn>): Promise<string> {
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const session = new OpenAiTranscriptionSession('openai-gpt-4o-transcribe', () => 'sk-test')
      session.feedAudio(new Float32Array(1600), 16000)
      return await session.finish()
    } finally {
      vi.unstubAllGlobals()
      vi.restoreAllMocks()
    }
  }

  it('retries once when the connection drops', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(networkError('UND_ERR_SOCKET'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ text: 'готово' })))
    await expect(finishWith(fetchMock)).resolves.toBe('готово')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('names the network cause when the retry fails too', async () => {
    const fetchMock = vi.fn().mockRejectedValue(networkError('ECONNRESET'))
    await expect(finishWith(fetchMock)).rejects.toThrow(
      'OpenAI transcription request failed: fetch failed (ECONNRESET)'
    )
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does not retry an HTTP error from OpenAI', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ error: { message: 'quota' } }), { status: 429 })
      )
    await expect(finishWith(fetchMock)).rejects.toThrow('OpenAI transcription failed: quota')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
