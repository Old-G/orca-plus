import { describe, expect, it } from 'vitest'
import type { HqWaiting } from '../../../../../shared/hq-pulse-snapshot'
import { buildHqNotesBoard, groupHqNotesByPerson } from './hq-notes-board'

function waiting(id: string, overrides: Partial<HqWaiting> = {}): HqWaiting {
  return {
    id,
    direction: 'on-them',
    title: id,
    personId: null,
    project: null,
    dueAt: null,
    createdAt: 1_000,
    source: 'slack',
    ...overrides
  }
}

describe('buildHqNotesBoard', () => {
  it('puts answers first, newest answer on top, and keeps notes and overdue apart', () => {
    const reply = (at: number) => ({ text: 'ok', author: 'Ann', at, deliveredAt: null })
    const board = buildHqNotesBoard(
      [
        waiting('asked'),
        waiting('old-answer', { reply: reply(5) }),
        waiting('new-answer', { reply: reply(9) }),
        waiting('on-me', { direction: 'on-me' }),
        waiting('note', { source: 'note', dueAt: 50 }),
        waiting('late', { dueAt: 50 })
      ],
      100
    )
    expect(board.answered.map((w) => w.id)).toEqual(['new-answer', 'old-answer'])
    expect(board.waiting.map((w) => w.id)).toEqual(['asked', 'late'])
    expect(board.onMe.map((w) => w.id)).toEqual(['on-me'])
    expect(board.notes.map((w) => w.id)).toEqual(['note'])
    expect(board.overdue.map((w) => w.id)).toEqual(['note', 'late'])
  })
})

describe('groupHqNotesByPerson', () => {
  it('leads with whoever has been kept waiting longest, oldest ask first', () => {
    const names: Record<string, string> = { p1: 'Женя', p2: 'Марина' }
    const groups = groupHqNotesByPerson(
      [
        waiting('zhenya-new', { personId: 'p1', createdAt: 30 }),
        waiting('marina', { personId: 'p2', createdAt: 10 }),
        waiting('zhenya-old', { personId: 'p1', createdAt: 20 }),
        waiting('nobody', { createdAt: 40 })
      ],
      (id) => names[id] ?? null
    )
    expect(groups.map((g) => [g.name, g.items.map((w) => w.id)])).toEqual([
      ['Марина', ['marina']],
      ['Женя', ['zhenya-old', 'zhenya-new']],
      [null, ['nobody']]
    ])
  })
})
