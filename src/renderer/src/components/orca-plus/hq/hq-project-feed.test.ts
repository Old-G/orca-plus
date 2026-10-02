import { describe, expect, it } from 'vitest'
import { buildHqProjectFeed } from './hq-project-feed'
import type { HqDecision } from './hq-pulse-snapshot'

function decision(id: string, project: string | null, decidedAt: number): HqDecision {
  return { id, kind: 'decision', title: id, outcome: null, project, decidedAt }
}

describe('buildHqProjectFeed', () => {
  it('merges commits and this project’s decisions newest first, up to the limit', () => {
    const feed = buildHqProjectFeed(
      [
        { id: 'aaaaaaaa1', parentIds: [], subject: 'old fix', message: '', timestamp: 10 },
        {
          id: 'bbbbbbbb2',
          displayId: 'bbbbbbb',
          parentIds: [],
          subject: 'new feature',
          message: '',
          author: 'Ann',
          timestamp: 30
        },
        { id: 'cccccccc3', parentIds: [], subject: 'no time', message: '' }
      ],
      [
        decision('ship it', 'shop', 20),
        decision('elsewhere', 'blog', 40),
        decision('loose', null, 50)
      ],
      'shop',
      10
    )
    expect(feed.map((entry) => entry.title)).toEqual(['new feature', 'ship it', 'old fix'])
    expect(feed[0]).toMatchObject({ kind: 'commit', hash: 'bbbbbbb', author: 'Ann' })
    expect(feed[2]).toMatchObject({ hash: 'aaaaaaa', author: null })
    expect(buildHqProjectFeed([], [decision('x', 'shop', 1)], 'shop', 0)).toEqual([])
  })

  it('shows no decisions for a project HQ has no page for', () => {
    expect(buildHqProjectFeed([], [decision('x', null, 1)], null, 5)).toEqual([])
  })
})
