import { describe, expect, it } from 'vitest'
import type { NativeChatMessage } from '../../../../../shared/native-chat-types'
import { lastAnswerText, speakableText, speechChunks } from './read-aloud-text'

function message(
  role: NativeChatMessage['role'],
  blocks: NativeChatMessage['blocks'],
  id = `${role}-${Math.random()}`
): NativeChatMessage {
  return { id, role, blocks, timestamp: null, source: 'transcript' }
}
const text = (value: string) => ({ type: 'text' as const, text: value })

describe('lastAnswerText', () => {
  it('takes the agent text after its last tool call, not the steps before it', () => {
    const tool = { type: 'tool-call' as const, name: 'Bash', input: {} }
    const messages = [
      message('user', [text('сделай')]),
      message('assistant', [text('Смотрю код.'), tool]),
      message('tool', [text('ok')]),
      message('reasoning', [text('думаю')]),
      message('assistant', [text('Готово.')]),
      message('assistant', [text('Тесты зелёные.')])
    ]
    expect(lastAnswerText(messages)).toBe('Готово.\n\nТесты зелёные.')
    expect(lastAnswerText([message('user', [text('привет')])])).toBe('')
  })
})

describe('speakableText', () => {
  it('drops code, link targets and markdown marks, and ends each line as a sentence', () => {
    expect(
      speakableText(
        [
          '## Итог',
          '- **Собрано** и `выкачено`',
          '- [задача](https://app.clickup.com/t/1) закрыта',
          '```ts',
          'const x = 1',
          '```',
          '| Что | Статус |',
          '|---|---|',
          '| тесты | зелёные |',
          'Ссылка: https://example.com/x'
        ].join('\n')
      )
    ).toBe('Итог. Собрано и выкачено. задача закрыта. Что, Статус. тесты, зелёные. Ссылка:')
  })
})

describe('speechChunks', () => {
  it('splits by sentences into pieces a voice reads without stalling', () => {
    const long = Array.from({ length: 30 }, (_, i) => `Предложение номер ${i}.`).join(' ')
    const chunks = speechChunks(long)
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.every((chunk) => chunk.length <= 240)).toBe(true)
    expect(chunks.join(' ')).toBe(long)
    expect(speechChunks('Без точки в конце')).toEqual(['Без точки в конце'])
  })
})
