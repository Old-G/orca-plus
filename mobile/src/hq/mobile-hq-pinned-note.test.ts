import { describe, expect, it } from 'vitest'
import { mobileHqPinnedNote } from './mobile-hq-pinned-note'

const COUNTS = { today: 0, onYou: 1, remind: 2, reports: 0, feed: 5, journal: 0 }

describe('mobileHqPinnedNote', () => {
  it('matches the desktop counts and tones', () => {
    expect(mobileHqPinnedNote(COUNTS, 'notes')).toEqual({
      text: '1 on you · 2 to remind',
      needs: true
    })
    expect(mobileHqPinnedNote(COUNTS, 'feed')).toEqual({ text: '5 new', needs: false })
    expect(mobileHqPinnedNote(COUNTS, 'today')).toBeNull()
    expect(mobileHqPinnedNote(null, 'feed')).toBeNull()
  })
})
