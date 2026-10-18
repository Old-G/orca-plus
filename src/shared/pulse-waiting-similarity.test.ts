import { describe, expect, it } from 'vitest'
import type { PulseWaiting } from './pulse-types'
import { findDuplicateWaiting, waitingTitleSimilarity } from './pulse-waiting-similarity'

function waiting(title: string, personId: string | null = 'timur', status = 'open'): PulseWaiting {
  return {
    id: title,
    direction: 'on-them',
    personId,
    project: null,
    title,
    detail: null,
    source: 'slack',
    sourceRef: null,
    status: status === 'open' ? 'open' : 'resolved',
    dueAt: null,
    resolution: null,
    createdAt: 0,
    resolvedAt: null,
    agentSessionId: null,
    paneKey: null,
    worktreeId: null,
    reply: null,
    replyAuthor: null,
    replyTs: null,
    repliedAt: null,
    replyDeliveredAt: null
  }
}

describe('waiting title similarity', () => {
  it.each([
    ['Выгрузка за март готова?', 'выгрузка за март готова?'],
    ['Выгрузка за март готова?', 'готовность выгрузки за март'],
    ['Тимур: настроить вебхук Zoho', 'настроить вебхук Zoho'],
    ['Ёлка в офисе', 'елка в офисе']
  ])('reads %s and %s as the same', (a, b) => {
    expect(waitingTitleSimilarity(a, b)).toBeGreaterThanOrEqual(0.8)
  })

  it('reads different tasks as different', () => {
    expect(waitingTitleSimilarity('Выгрузка за март', 'Доступ к серверу UAT')).toBeLessThan(0.3)
  })
})

describe('findDuplicateWaiting', () => {
  const open = [waiting('Выгрузка за март готова?'), waiting('hub !215: влить правило реактивации')]

  it('finds the open note about the same person that says the same', () => {
    expect(
      findDuplicateWaiting(open, { title: 'готовность выгрузки за март', personId: 'timur' })?.id
    ).toBe('Выгрузка за март готова?')
  })

  it('keeps notes about another person, another number or a closed one apart', () => {
    expect(
      findDuplicateWaiting(open, { title: 'Выгрузка за март готова?', personId: 'vera' })
    ).toBeNull()
    expect(
      findDuplicateWaiting(open, {
        title: 'hub !222: влить правило реактивации',
        personId: 'timur'
      })
    ).toBeNull()
    expect(
      findDuplicateWaiting([waiting('Выгрузка за март', 'timur', 'resolved')], {
        title: 'Выгрузка за март',
        personId: 'timur'
      })
    ).toBeNull()
  })

  it('matches plain notes with no person only to each other', () => {
    expect(
      findDuplicateWaiting([waiting('Продлить домен', null)], { title: 'продлить домен' })?.id
    ).toBe('Продлить домен')
    expect(
      findDuplicateWaiting([waiting('Продлить домен')], { title: 'продлить домен' })
    ).toBeNull()
  })
})
