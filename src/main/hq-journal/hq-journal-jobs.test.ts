import { describe, expect, it } from 'vitest'
import type { HqJournalEntry } from '../../shared/hq-journal'
import { hqJobReplyRows, hqJobRow } from './hq-journal-jobs'

const place = { room: 'acme', project: 'acme-app', firm: true }

describe('a background job report', () => {
  it('waits on the owner only when it asks, with the options in the question line', () => {
    const asks = hqJobRow(
      { job: 'commit-review', ask: 'Fix the P1 now?', options: ['now', ' skip '], found: '1 P1' },
      place,
      5
    )
    expect(asks).toMatchObject({
      kind: 'job.report',
      address: 'job/commit-review',
      needs: 'owner:decide',
      status: 'open',
      refId: 'commit-review',
      supersedes: true,
      body: 'Found: 1 P1\nQuestion: Fix the P1 now? (options: now | skip)'
    })
    const quiet = hqJobRow({ job: 'slack-scout', did: '2 answered' }, place, 6)
    expect(quiet).toMatchObject({
      needs: 'nobody',
      status: 'done',
      title: 'slack-scout: 2 answered'
    })
    expect(quiet.dedupeKey).not.toBe(asks.dedupeKey)
  })

  it("answers in the job's thread and settles its question; a chat's row is refused", () => {
    const asked = hqJobRow({ job: 'commit-review', ask: 'Fix now?' }, place, 5)
    const entry: HqJournalEntry = {
      ...asked,
      id: 'e-1',
      at: 5,
      body: asked.body ?? null,
      status: 'open',
      links: [],
      dedupeKey: asked.dedupeKey ?? null
    }
    const [answer, settled] = hqJobReplyRows(entry, 'now', 9)
    expect(answer).toMatchObject({
      kind: 'chat.message',
      address: 'job/commit-review',
      title: 'From HQ+: now',
      replyTo: 'e-1',
      needs: 'agent:job/commit-review'
    })
    expect(settled).toMatchObject({ dedupeKey: asked.dedupeKey, status: 'done' })
    expect(() => hqJobReplyRows({ ...entry, kind: 'chat.report' }, 'now', 9)).toThrow(
      /not a background/
    )
  })
})
