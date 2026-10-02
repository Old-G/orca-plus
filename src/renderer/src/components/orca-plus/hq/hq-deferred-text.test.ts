import { describe, expect, it } from 'vitest'
import { hqAnswerAsksUser } from './hq-deferred-text'

describe('hqAnswerAsksUser', () => {
  it('sees a question or a request handed back to the user', () => {
    for (const text of [
      'Готово. Пушить?',
      'Всё собрал. Скажи «да» — и выкачу.',
      'Жду твоего решения по схеме.',
      'Нужно от тебя: токен GitLab.',
      'Deployed to staging. Should I promote it?',
      'Let me know which option you prefer.',
      'Done, but I need your approval for the migration.',
      'Варианты: А или Б? **'
    ]) {
      expect(hqAnswerAsksUser(text), text).toBe(true)
    }
  })

  it('reads a final report as finished', () => {
    for (const text of [
      'Готово: тесты зелёные, запушено, выкачено.',
      'Я решил задачу и всё проверил.',
      'All 42 tests pass and the PR is merged.',
      '',
      null
    ]) {
      expect(hqAnswerAsksUser(text), String(text)).toBe(false)
    }
  })

  it('only looks at the end of a long answer', () => {
    expect(hqAnswerAsksUser(`Пушить? ${'Готово. '.repeat(100)}`)).toBe(false)
  })
})
