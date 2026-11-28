import { describe, expect, it } from 'vitest'
import { hqTaskOfBrief, hqTaskRefusalText, parseHqTaskFlag } from './hq-task-lock'

const BRIEF = [
  'W · T3 refund cap. От лида (LEAD · Refunds, acme-api/lead-refunds, 22222222-2222-4222-8222-222222222222).',
  'Задача: T3. Цель и результат: one cap. Проект: acme-api.',
  'Контекст: runs/2026-11-28-refunds/T1.md (earlier row), runs/2026-11-28-refunds/rakes.md.',
  'Проверка: строка T3 в runs/2026-11-28-refunds.md.',
  'Ход — в runs/2026-11-28-refunds/T3.md. Отчёт лиду: только DONE / NEEDS DECISION / BLOCKED.'
].join('\n')

describe('hqTaskOfBrief (hq-task-lock, A3)', () => {
  it('takes the row from the brief’s task file line, not from other files it links', () => {
    expect(hqTaskOfBrief(BRIEF)).toEqual({ plan: '2026-11-28-refunds', row: 'T3' })
  })

  it('reads an absolute task file path and multi-part rows', () => {
    const brief = 'W · A1A2 lead address.\nХод — в /Users/me/HQ/runs/2026-11-28-orca-ai-ux/A1A2.md.'
    expect(hqTaskOfBrief(brief)).toEqual({ plan: '2026-11-28-orca-ai-ux', row: 'A1A2' })
  })

  it('falls back to a lock file the brief names', () => {
    const brief = 'SUB-LEAD · Billing › acme-api.\nЛок: runs/2026-11-28-billing/S18b.lock.'
    expect(hqTaskOfBrief(brief)).toEqual({ plan: '2026-11-28-billing', row: 'S18b' })
  })

  it('takes no row for a reviewer, the Lead or a prompt that is no brief', () => {
    expect(hqTaskOfBrief(BRIEF.replace(/^W ·/, 'REVIEW ·'))).toBeNull()
    expect(hqTaskOfBrief(BRIEF.replace(/^W ·/, 'LEAD ·'))).toBeNull()
    expect(hqTaskOfBrief('Fix the build, see runs/2026-11-28-refunds/T3.md')).toBeNull()
    expect(hqTaskOfBrief('W · T3.\nХод — в runs/2026-11-28-refunds/rakes.md')).toBeNull()
    expect(hqTaskOfBrief(undefined)).toBeNull()
  })
})

describe('parseHqTaskFlag', () => {
  it('takes <plan>:<row> with the plan as a name or a path', () => {
    expect(parseHqTaskFlag('2026-11-28-refunds:T3')).toEqual({
      plan: '2026-11-28-refunds',
      row: 'T3'
    })
    expect(parseHqTaskFlag('/Users/me/HQ/runs/2026-11-28-refunds.md#T5c')).toEqual({
      plan: '2026-11-28-refunds',
      row: 'T5c'
    })
  })

  it('reads none as no lock and refuses a value without a row', () => {
    expect(parseHqTaskFlag('none')).toBeNull()
    expect(() => parseHqTaskFlag('2026-11-28-refunds')).toThrow(/--task takes <plan>:<row>/)
    expect(() => parseHqTaskFlag(':T3')).toThrow(/--task takes/)
  })
})

describe('hqTaskRefusalText', () => {
  it('names the open chat and how to reach it', () => {
    const text = hqTaskRefusalText(
      { plan: '2026-11-28-refunds', row: 'T3' },
      {
        taken: false,
        reason: 'open',
        holder: { sessionId: 's-1', address: 'acme-api/w-refund-cap', state: 'working' }
      },
      0
    )
    expect(text).toContain('T3 of 2026-11-28-refunds already runs in an open chat')
    expect(text).toContain('acme-api/w-refund-cap (s-1, working)')
    expect(text).toContain('orca chat send s-1')
    expect(text).toContain('--task none')
  })
})
