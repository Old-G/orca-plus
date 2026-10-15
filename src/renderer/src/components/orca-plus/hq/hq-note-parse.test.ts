import { describe, expect, it } from 'vitest'
import { parseHqNote } from './hq-note-parse'

// Thursday 15 October 2026, 22:00 local.
const NOW = new Date(2026, 9, 15, 22, 0).getTime()

function day(month: number, date: number): number {
  return new Date(2026, month, date, 23, 59).getTime()
}

describe('HQ note parsing', () => {
  it('reads «@person жду … до пт» as me waiting on them, due Friday', () => {
    expect(parseHqNote('@Ирина жду выгрузку возвратов до пт', NOW)).toEqual({
      title: 'жду выгрузку возвратов до пт',
      personName: 'Ирина',
      direction: 'on-them',
      dueAt: day(9, 16)
    })
  })

  it('reads «ждёт» as someone waiting on me', () => {
    expect(parseHqNote('@Женя ждёт ответ про владельца зоны', NOW)).toMatchObject({
      personName: 'Женя',
      direction: 'on-me',
      dueAt: null
    })
  })

  it('keeps a line without a person as a plain note, with its date', () => {
    expect(parseHqNote('обсудить с Женей схему автопилота завтра', NOW)).toMatchObject({
      personName: null,
      direction: null,
      dueAt: day(9, 16)
    })
    expect(parseHqNote('сдать отчёт до 20.10', NOW).dueAt).toBe(day(9, 20))
    // A date already past this year means next year.
    expect(parseHqNote('план к 01.02', NOW).dueAt).toBe(new Date(2027, 1, 1, 23, 59).getTime())
  })

  it('takes «до пн» to the next Monday, not today, and leaves unknown words alone', () => {
    expect(parseHqNote('@Саша жду фикс до пн', NOW).dueAt).toBe(day(9, 19))
    expect(parseHqNote('до лучших времён', NOW).dueAt).toBeNull()
  })
})
