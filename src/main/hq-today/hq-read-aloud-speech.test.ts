import { describe, expect, it, vi } from 'vitest'

const keys = vi.hoisted(() => ({ has: true }))
vi.mock('../speech/openai-api-key-store', () => ({
  hasOpenAiSpeechApiKey: () => keys.has,
  readOpenAiSpeechApiKey: () => 'sk-test'
}))

import { synthesizeHqReadAloud } from './hq-read-aloud-speech'

describe('synthesizeHqReadAloud', () => {
  it('asks the speech model for Russian mp3 with a known voice', async () => {
    const fetchImpl = vi.fn(
      async (_url: string | URL | Request, _init?: RequestInit) =>
        new Response(new Uint8Array([1, 2, 3]))
    )
    const result = await synthesizeHqReadAloud({ text: 'Привет', voice: 'evil' }, fetchImpl)
    expect(result).toEqual({ ok: true, audio: new Uint8Array([1, 2, 3]) })
    const [url, init] = fetchImpl.mock.calls[0] ?? []
    expect(url).toBe('https://api.openai.com/v1/audio/speech')
    expect(JSON.parse(String(init?.body))).toMatchObject({
      model: 'gpt-4o-mini-tts',
      voice: 'nova',
      input: 'Привет',
      response_format: 'mp3'
    })
  })

  it('says so without a key or when the API refuses, so the system voice reads', async () => {
    keys.has = false
    expect(await synthesizeHqReadAloud({ text: 'x', voice: 'nova' }, vi.fn())).toEqual({
      ok: false,
      error: 'no-key'
    })
    keys.has = true
    const refused = vi.fn(async () => new Response('', { status: 429 }))
    expect(await synthesizeHqReadAloud({ text: 'x', voice: 'nova' }, refused)).toEqual({
      ok: false,
      error: 'OpenAI speech answered 429'
    })
  })
})
