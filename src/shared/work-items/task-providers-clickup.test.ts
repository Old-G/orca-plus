import { describe, expect, it } from 'vitest'
import { normalizeVisibleTaskProviders } from './task-providers'

// Custom build (clickup-core): kept from the task-providers suite upstream removed (#39547).
describe('task providers with ClickUp', () => {
  it('falls back to all providers when none are visible', () => {
    expect(normalizeVisibleTaskProviders([])).toEqual([
      'github',
      'gitlab',
      'linear',
      'jira',
      'clickup'
    ])
  })
})
