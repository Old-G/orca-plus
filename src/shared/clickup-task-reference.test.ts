import { describe, expect, it } from 'vitest'
import { parseClickUpTaskReference } from './clickup-task-reference'

describe('parseClickUpTaskReference', () => {
  it.each([
    ['https://app.clickup.com/t/86abc1234', { id: '86abc1234', custom: false }],
    ['https://app.clickup.com/t/90000001/DEV-10001', { id: 'DEV-10001', custom: true }],
    ['dev-10001', { id: 'DEV-10001', custom: true }],
    ['12487v2bnr5', { id: '12487v2bnr5', custom: false }]
  ])('parses %s', (input, expected) => {
    expect(parseClickUpTaskReference(input)).toEqual(expected)
  })

  it.each([
    '',
    'dashboard',
    'fix login',
    'https://example.com/t/86abc1234',
    'https://app.clickup.com/90000001/v/cn/abc/t/86abc1234',
    'https://app.clickup.com/90000001/v/l/li/900000000001'
  ])('rejects %s', (input) => {
    expect(parseClickUpTaskReference(input)).toBeNull()
  })
})
