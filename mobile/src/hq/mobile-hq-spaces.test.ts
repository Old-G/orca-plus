import { describe, expect, it } from 'vitest'
import { mobileHqShows, mobileHqShowsReport, mobileHqShowsSourced } from './mobile-hq-spaces'

const FILTER = {
  spaces: [
    {
      slug: 'acme',
      name: 'Acme',
      color: '#3b82f6',
      repoIds: ['r-api'],
      projects: ['acme-api'],
      messenger: 'slack',
      tasks: 'clickup'
    },
    { slug: 'hobby', name: 'Hobby', color: '#a855f7', repoIds: ['r-h'], projects: ['hobby'] }
  ],
  active: 'hobby'
}

describe('the phone’s workspace filter', () => {
  it('keeps the chosen workspace’s records and the unclaimed ones', () => {
    expect(mobileHqShows(FILTER, { repoId: 'r-api' })).toBe(false)
    expect(mobileHqShows(FILTER, { project: 'hobby' })).toBe(true)
    expect(mobileHqShows(FILTER, { project: 'strata' })).toBe(true)
  })

  it('places Slack without a project by the workspace’s messenger', () => {
    expect(mobileHqShowsSourced(FILTER, null, 'slack')).toBe(false)
    expect(mobileHqShowsSourced({ ...FILTER, active: 'acme' }, null, 'slack')).toBe(true)
  })

  it('shows a workspace’s report only in it', () => {
    expect(mobileHqShowsReport(FILTER, 'acme')).toBe(false)
    expect(mobileHqShowsReport(FILTER, undefined)).toBe(true)
  })
})
