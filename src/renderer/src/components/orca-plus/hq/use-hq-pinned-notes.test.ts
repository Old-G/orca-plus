import { describe, expect, it } from 'vitest'
import { hqPinnedNotes } from './use-hq-pinned-notes'

describe('hqPinnedNotes', () => {
  it('colours what waits for the owner and greys what is merely new', () => {
    const notes = hqPinnedNotes(
      { today: 3, onYou: 2, remind: 1, reports: 1, feed: 140, journal: 0 },
      4
    )
    expect(notes).toEqual({
      today: { text: '3 to decide', tone: 'needs' },
      waiting: { text: '2 on you · 1 to remind', tone: 'needs' },
      reports: { text: '1 new', tone: 'needs' },
      feed: { text: '99+ new', tone: 'new' },
      agents: { text: '4 deferred', tone: 'needs' }
    })
  })

  it('shows nothing before the counts arrive', () => {
    expect(hqPinnedNotes(null, 0)).toEqual({})
  })
})
