import { describe, expect, it } from 'vitest'
import { parseClickUpTaskReference } from './clickup-task-reference'

describe('parseClickUpTaskReference', () => {
  it.each([
    ['https://app.clickup.com/t/86cbcnw23', { id: '86cbcnw23', custom: false }],
    ['https://app.clickup.com/t/31632516/DEV-17089', { id: 'DEV-17089', custom: true }],
    ['dev-17089', { id: 'DEV-17089', custom: true }],
    ['12487v2bnr5', { id: '12487v2bnr5', custom: false }]
  ])('parses %s', (input, expected) => {
    expect(parseClickUpTaskReference(input)).toEqual(expected)
  })

  it.each([
    '',
    'dashboard',
    'fix login',
    'https://example.com/t/86cbcnw23',
    'https://app.clickup.com/31632516/v/cn/abc/t/86cbcnw23',
    'https://app.clickup.com/31632516/v/l/li/901520612528'
  ])('rejects %s', (input) => {
    expect(parseClickUpTaskReference(input)).toBeNull()
  })
})
