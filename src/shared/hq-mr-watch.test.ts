import { describe, expect, it } from 'vitest'
import {
  hqMrIntent,
  hqMrMentions,
  hqMrOutcome,
  hqMrRepoByName,
  parseHqMrRepo,
  type HqMrState
} from './hq-mr-watch'

const REPOS = ['acme/acme-hub', 'acme/acme-priority-bridge', 'acme/support-service']

function mr(overrides: Partial<HqMrState> = {}): HqMrState {
  return {
    state: 'opened',
    title: 'Spec edits',
    url: 'https://gitlab.com/acme/acme-hub/-/merge_requests/380',
    mergedBy: null,
    mergedAt: null,
    closedAt: null,
    approvedBy: [],
    ...overrides
  }
}

describe('hqMrMentions', () => {
  it('reads MR links and bare numbers, not exclamations or a link’s own number', () => {
    expect(
      hqMrMentions(
        'Approve hub !380: spec edits. Привет!3 See https://gitlab.com/acme/acme-hub/-/merge_requests/381'
      )
    ).toEqual({
      refs: [{ host: 'gitlab.com', projectPath: 'acme/acme-hub', iid: 381 }],
      bare: [380]
    })
    expect(hqMrMentions('No MR here, just DEV-17099!')).toEqual({ refs: [], bare: [] })
  })
})

describe('hqMrIntent', () => {
  it('waits for a merge unless the waiting only asks for an approval', () => {
    expect(hqMrIntent('Апрув hub !380: closed code')).toBe('approve')
    expect(hqMrIntent('Влить hub !381 и ответить на 2 вопроса')).toBe('merge')
    expect(hqMrIntent('Review and merge !12')).toBe('merge')
    expect(hqMrIntent('hub !7')).toBe('merge')
  })
})

describe('repo of a project', () => {
  it('matches the slug by name first, and keeps only a listed repo from the model', () => {
    expect(hqMrRepoByName('support_service', REPOS)).toBe('acme/support-service')
    expect(hqMrRepoByName('hub', REPOS)).toBeNull()
    expect(parseHqMrRepo('acme/acme-priority-bridge', REPOS)).toBe('acme/acme-priority-bridge')
    expect(parseHqMrRepo('NONE', REPOS)).toBeNull()
    expect(parseHqMrRepo('acme/unknown', REPOS)).toBeNull()
  })
})

describe('hqMrOutcome', () => {
  const ref = { host: 'gitlab.com', projectPath: 'acme/acme-hub', iid: 380 }
  const NOW = 1_800_000_000_000

  it('answers a merge wait on merge, and an approval wait on the first approval', () => {
    expect(
      hqMrOutcome(
        ref,
        mr({ state: 'merged', mergedBy: 'Ann', mergedAt: '2026-10-28T13:40:00Z' }),
        'merge',
        NOW
      )
    ).toEqual({
      done: true,
      text: 'MR !380 (acme/acme-hub) merged by Ann — Spec edits',
      at: Date.parse('2026-10-28T13:40:00Z')
    })
    expect(hqMrOutcome(ref, mr({ approvedBy: ['Bob'] }), 'merge', NOW)).toEqual({
      done: false,
      status: 'GitLab: !380 opened, approved by Bob'
    })
    expect(hqMrOutcome(ref, mr({ approvedBy: ['Bob'] }), 'approve', NOW)).toMatchObject({
      done: true,
      text: 'MR !380 (acme/acme-hub) approved by Bob — Spec edits'
    })
    expect(hqMrOutcome(ref, mr(), 'approve', NOW)).toEqual({
      done: false,
      status: 'GitLab: !380 opened, no approvals'
    })
  })
})
