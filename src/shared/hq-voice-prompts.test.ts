import { describe, expect, it } from 'vitest'
import { detectHqVoiceMode, hqIdeaFileName, hqVoicePrompt } from './hq-voice-prompts'

describe('detectHqVoiceMode', () => {
  it('reads the mode from the first words and strips them', () => {
    expect(detectHqVoiceMode('Для агента, почини тест в zenith')).toEqual({
      mode: 'agent',
      text: 'почини тест в zenith'
    })
    expect(detectHqVoiceMode('человеку: Петя, глянь MR')).toEqual({
      mode: 'person',
      text: 'Петя, глянь MR'
    })
    expect(detectHqVoiceMode('В кликап — бот отвечает не на том языке').mode).toBe('clickup')
    expect(detectHqVoiceMode('Идея. Сводка по почте утром').mode).toBe('idea')
  })

  it('leaves text without a mode phrase alone, including words that only start like one', () => {
    expect(detectHqVoiceMode('  агентура не при чём ')).toEqual({
      mode: null,
      text: 'агентура не при чём'
    })
    expect(detectHqVoiceMode('идеальный вариант').mode).toBeNull()
  })
})

describe('hqVoicePrompt', () => {
  it('fences the dictation as data and adds the tone only for a person', () => {
    const person = hqVoicePrompt('person', 'привет', 'Без смайликов.')
    expect(person).toContain('Без смайликов.')
    expect(person).toContain('<<<\nпривет\n>>>')
    expect(hqVoicePrompt('agent', 'x', 'Без смайликов.')).not.toContain('Без смайликов.')
  })
})

describe('hqIdeaFileName', () => {
  it('names the file by date and the first line', () => {
    expect(hqIdeaFileName('# Сводка по почте!\nтекст', new Date(2026, 9, 17))).toBe(
      '2026-10-17-сводка-по-почте.md'
    )
    expect(hqIdeaFileName('', new Date(2026, 0, 2))).toBe('2026-01-02-idea.md')
  })
})
