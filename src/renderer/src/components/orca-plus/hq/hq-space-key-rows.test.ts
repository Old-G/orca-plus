import { describe, expect, it, vi } from 'vitest'

vi.mock('@/i18n/i18n', () => ({ translate: (_key: string, fallback: string) => fallback }))

import { hqSpaceKeyRows } from './HqSpaceKeysDialog'

const SPACE = { slug: 'hobby', name: 'Hobby', color: '#a855f7', repoIds: [], projects: [] }

describe('hqSpaceKeyRows', () => {
  it('shows the usual three, plus what the workspace names or saved', () => {
    expect(hqSpaceKeyRows(SPACE, [])).toEqual(['slack', 'telegram', 'clickup'])
    expect(hqSpaceKeyRows({ ...SPACE, tasks: 'jira' }, ['asana'])).toEqual([
      'slack',
      'telegram',
      'clickup',
      'jira',
      'asana'
    ])
  })
})
