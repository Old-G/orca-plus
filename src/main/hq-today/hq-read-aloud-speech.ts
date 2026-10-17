// Custom build (hq-read-aloud): a natural Russian voice for «Read aloud» — OpenAI's speech model with
// the key Orca already keeps for dictation. Without a key the renderer falls back to the system voice.
import { hasOpenAiSpeechApiKey, readOpenAiSpeechApiKey } from '../speech/openai-api-key-store'
import {
  HQ_READ_ALOUD_NEURAL_VOICES,
  type HqReadAloudSpeechResult
} from '../../shared/hq-read-aloud'

const ENDPOINT = 'https://api.openai.com/v1/audio/speech'
const MODEL = 'gpt-4o-mini-tts'
const INPUT_MAX = 4000
const TIMEOUT_MS = 60_000
const INSTRUCTIONS = [
  'Говори по-русски естественно и живо, как человек, который коротко докладывает коллеге.',
  'Чёткая дикция, бодрый ровный темп, нормальная разговорная интонация, без театральности и пафоса.',
  'Английские названия и термины произноси так, как их говорят русские разработчики.'
].join(' ')

export async function synthesizeHqReadAloud(
  request: { text: string; voice: string },
  fetchImpl: typeof fetch = fetch
): Promise<HqReadAloudSpeechResult> {
  if (!hasOpenAiSpeechApiKey()) {
    return { ok: false, error: 'no-key' }
  }
  const voice = HQ_READ_ALOUD_NEURAL_VOICES.find((entry) => entry === request.voice) ?? 'nova'
  try {
    const response = await fetchImpl(ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${readOpenAiSpeechApiKey()}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: MODEL,
        voice,
        input: request.text.slice(0, INPUT_MAX),
        instructions: INSTRUCTIONS,
        response_format: 'mp3'
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS)
    })
    if (!response.ok) {
      return { ok: false, error: `OpenAI speech answered ${response.status}` }
    }
    return { ok: true, audio: new Uint8Array(await response.arrayBuffer()) }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}
