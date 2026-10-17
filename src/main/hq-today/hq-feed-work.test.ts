import { describe, expect, it } from 'vitest'
import type { OutgoingSentContext } from '../../shared/outgoing-approval/outgoing-sent-context'
import { agentFinishedBellItem } from '../../shared/pulse-bell'
import type { PulseDecision, PulseDraft, PulseInboxItem } from '../../shared/pulse-types'
import { commitFeedItems, readHqFeedCommits, sentFeedItems, sessionFeedItems } from './hq-feed-work'

const NOW = Date.parse('2026-10-17T12:00:00Z')

const EMPTY_CONTEXT: OutgoingSentContext = {
  service: null,
  operation: null,
  targetName: null,
  targetId: null,
  threadTs: null,
  replyingTo: null,
  chatName: null,
  agentSessionId: null,
  worktreeId: null,
  project: null,
  head: null,
  taskId: null,
  taskUrl: null,
  taskName: null,
  ref: null,
  footer: null,
  movedTo: null
}

const decision = (over: Partial<PulseDecision>): PulseDecision => ({
  id: 'd1',
  kind: 'approval',
  title: 'Slack · send message',
  body: 'Женя, MR готов',
  outcome: 'approved',
  project: null,
  personId: null,
  draftId: 'r1',
  source: 'outgoing-approval',
  decidedAt: NOW,
  mirroredPath: null,
  sentContext: null,
  ...over
})

const draft = (over: Partial<PulseDraft>): PulseDraft => ({
  id: 'r1',
  kind: 'message',
  target: 'D1',
  title: null,
  body: 'Женя, MR готов',
  project: null,
  personId: null,
  source: 'outgoing-approval',
  sourceRef: null,
  fingerprint: null,
  status: 'sent',
  createdAt: NOW,
  updatedAt: NOW,
  ...over
})

describe('hq feed work items', () => {
  it('reads commits per project, skipping a project git cannot read and bookkeeping commits', async () => {
    const commits = await readHqFeedCommits(
      [
        { path: '/a', name: 'orca' },
        { path: '/b', name: 'broken' }
      ],
      async (cwd) => {
        if (cwd === '/b') {
          throw new Error('not a git repo')
        }
        return [
          'h1\x1f1760700000\x1fGleb\x1fcustom(feed): posts in Russian',
          'h2\x1f1760700100\x1fGleb\x1ffixup! custom(feed): posts',
          ''
        ].join('\n')
      }
    )
    expect(commits.map((commit) => commit.hash)).toEqual(['h1', 'h2'])
    expect(commits[0]).toMatchObject({ project: 'orca', at: 1_760_700_000_000 })
    expect(commitFeedItems(commits).map((item) => item.id)).toEqual(['commit:h1'])
  })

  it('turns a finished session with something to say into a row, and skips a bare «ok»', () => {
    const finished = (said: string, id: string): PulseInboxItem => {
      const input = agentFinishedBellItem({
        paneKey: `tab-${id}:0`,
        worktreeId: 'w1',
        agentLabel: 'Claude',
        place: 'orca-custom / custom',
        sessionTitle: 'Лента v2',
        lastMessage: said
      })
      return {
        id,
        kind: input.kind,
        title: input.title,
        body: input.body ?? null,
        urgency: 'normal',
        refKind: input.refKind ?? null,
        refId: input.refId ?? null,
        actions: [],
        dedupeKey: null,
        createdAt: NOW,
        readAt: null,
        doneAt: null,
        doneAction: null
      }
    }
    const rows = sessionFeedItems([
      finished('Готово: лента показывает коммиты и сессии, тесты зелёные, закоммичено.', 'i1'),
      finished('ok', 'i2')
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      id: 'session:i1',
      kind: 'session',
      title: 'Лента v2',
      project: 'orca-custom',
      person: 'Claude'
    })
  })

  it('keeps only messages to people that went out', () => {
    const rows = sentFeedItems(
      [
        decision({
          sentContext: {
            ...EMPTY_CONTEXT,
            service: 'Slack',
            targetName: 'DM with Женя',
            project: 'orca-custom'
          }
        }),
        decision({ id: 'd2', draftId: 'r2' }),
        decision({ id: 'd3', draftId: 'r3' }),
        decision({ id: 'd4', draftId: 'r4', outcome: 'rejected' }),
        decision({ id: 'd5', draftId: null })
      ],
      [
        draft({}),
        draft({ id: 'r2', kind: 'other' }),
        draft({ id: 'r3', status: 'failed' }),
        draft({ id: 'r4' })
      ]
    )
    expect(rows.map((row) => row.id)).toEqual(['orca:d1'])
    expect(rows[0]).toMatchObject({
      title: 'Slack → DM with Женя',
      body: 'Женя, MR готов',
      project: 'orca-custom'
    })
  })
})
