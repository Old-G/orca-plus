import { describe, expect, it } from 'vitest'
import { buildHqDoneJournal } from './hq-done-journal'

const WEEK = 7 * 24 * 60 * 60_000

describe('Done for you', () => {
  it('merges the last week of requests and approvals newest first, with web links only and Bring back on a skip', () => {
    const journal = buildHqDoneJournal(
      [
        {
          id: 'C1:1',
          decision: 'created',
          at: 10,
          title: 'Fix the cart',
          author: 'Laure',
          source: 'slack',
          taskUrl: 'https://app.clickup.com/t/1',
          permalink: 'https://lev.slack.com/archives/C1/p1'
        },
        { id: 'C1:2', decision: 'rejected', at: 30, permalink: 'javascript:alert(1)' },
        {
          id: 'clickup:a:c1',
          decision: 'answered',
          at: 5,
          title: 'Когда будет?',
          source: 'clickup',
          permalink: 'https://app.clickup.com/t/a'
        }
      ],
      [
        {
          id: 'd1',
          kind: 'approval',
          title: 'message → C1',
          outcome: 'edited',
          project: null,
          decidedAt: 20,
          body: 'Сделаю\n в пятницу)'
        },
        {
          id: 'd2',
          kind: 'decision',
          title: 'chose B',
          outcome: null,
          project: null,
          decidedAt: 25
        },
        {
          id: 'd3',
          kind: 'approval',
          title: 'a week ago',
          outcome: 'approved',
          project: null,
          decidedAt: 40 - WEEK
        }
      ],
      40
    )
    expect(journal.map((entry) => [entry.key, entry.what])).toEqual([
      ['request:C1:2', 'skipped'],
      ['approval:d1', 'sent-edited'],
      ['request:C1:1', 'task-created'],
      ['request:clickup:a:c1', 'replied']
    ])
    expect(journal[0]).toMatchObject({ title: 'C1:2', links: [], restoreId: 'C1:2' })
    expect(journal[1]).toMatchObject({ detail: 'Сделаю в пятницу)', restoreId: null })
    expect(journal[2]?.links).toEqual([
      { kind: 'task', url: 'https://app.clickup.com/t/1' },
      { kind: 'thread', url: 'https://lev.slack.com/archives/C1/p1' }
    ])
    expect(journal[2]?.detail).toBe('Laure · Slack')
    expect(journal[3]?.links).toEqual([{ kind: 'clickup', url: 'https://app.clickup.com/t/a' }])
  })
})
