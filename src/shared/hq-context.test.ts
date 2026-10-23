import { describe, expect, it } from 'vitest'
import { parseHqPlan, setHqPlanStep } from './hq-context'

const PLAN = [
  '# Acme billing',
  '## Этап 1. Счета',
  '- [x] **1.1 Модель счёта.** Готово.',
  '- [ ] **1.2 Экспорт в PDF.** Шаблон.',
  '## Этап 2. Оплаты',
  '- [ ] **2.1 Карты.** ■ ждёт ключи от Bob',
  '- [ ] **2.2 Возвраты.** ▶ сейчас',
  '- [ ] без номера'
].join('\n')

describe('parseHqPlan', () => {
  it('takes the ▶ step as current, ■ steps as blocked, numbers as ids', () => {
    const plan = parseHqPlan(PLAN)
    expect(plan.steps.map((step) => step.id)).toEqual(['1.1', '1.2', '2.1', '2.2', '#5'])
    expect(plan.current).toMatchObject({ id: '2.2', title: 'Возвраты', stage: 'Этап 2. Оплаты' })
    expect(plan.blocked).toEqual([
      expect.objectContaining({ id: '2.1', blockedBy: 'ждёт ключи от Bob' })
    ])
  })

  it('without ▶ the first open step that is not blocked is current', () => {
    expect(parseHqPlan(PLAN.replace(' ▶ сейчас', '')).current?.id).toBe('1.2')
  })

  it('ticks a step and drops its ▶; an unknown id changes nothing', () => {
    const next = setHqPlanStep(PLAN, '2.2', true) ?? ''
    expect(next).toContain('- [x] **2.2 Возвраты.** сейчас')
    expect(parseHqPlan(next).current?.id).toBe('1.2')
    expect(setHqPlanStep(PLAN, '9.9', true)).toBeNull()
  })
})
