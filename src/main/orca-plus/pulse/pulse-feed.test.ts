import { afterEach, describe, expect, it } from 'vitest'
import type { HqFeedItem } from '../../../shared/hq-feed'
import { onPulseChanged } from './pulse-change-events'
import { PulseDb } from './pulse-db'

const open: PulseDb[] = []
afterEach(() => {
  for (const db of open.splice(0)) {
    db.close()
  }
})

function db(): PulseDb {
  const created = new PulseDb(':memory:')
  open.push(created)
  return created
}

const item = (over: Partial<HqFeedItem> & Pick<HqFeedItem, 'id'>): HqFeedItem => ({
  source: 'slack',
  kind: 'conversation',
  at: 1_000,
  title: 'Тикеты по возвратам',
  body: null,
  url: null,
  project: null,
  person: null,
  ...over
})

describe('pulse feed', () => {
  it('keeps one row per thing: a repeat refreshes it and never moves it back in time', () => {
    const feed = db()
    let changed = 0
    const stop = onPulseChanged(() => (changed += 1))
    expect(
      feed.upsertFeed([item({ id: 'slack:T1' }), item({ id: 'git:pr', source: 'git', at: 500 })])
    ).toBe(2)
    expect(
      feed.upsertFeed([
        item({ id: 'slack:T1', at: 3_000, body: 'Вера ждёт', project: 'zenith' })
      ])
    ).toBe(0)
    expect(feed.upsertFeed([item({ id: 'slack:T1', at: 2_000, project: null })])).toBe(0)
    stop()
    const rows = feed.listFeed()
    expect(rows.map((row) => row.id)).toEqual(['slack:T1', 'git:pr'])
    expect(rows[0]).toMatchObject({ at: 3_000, project: 'zenith' })
    expect(changed).toBe(0)
  })

  it('filters by source, project and Russian words in any case, newest first', () => {
    const feed = db()
    feed.upsertFeed([
      item({ id: 'a', at: 1, title: 'Возвраты', project: 'zenith' }),
      item({ id: 'b', at: 2, source: 'clickup', title: 'DEV-1', body: 'Сделаю до пятницы' }),
      item({ id: 'c', at: 3, title: 'Другое', person: 'Петя' })
    ])
    expect(feed.listFeed({ source: 'clickup' }).map((row) => row.id)).toEqual(['b'])
    expect(feed.listFeed({ project: 'zenith' }).map((row) => row.id)).toEqual(['a'])
    expect(feed.listFeed({ query: 'ПЯТНИЦ' }).map((row) => row.id)).toEqual(['b'])
    expect(feed.listFeed({ query: 'петя' }).map((row) => row.id)).toEqual(['c'])
    expect(feed.listFeed({ before: 3, limit: 1 }).map((row) => row.id)).toEqual(['b'])
    expect(feed.pruneFeed(2)).toBe(1)
  })
})
