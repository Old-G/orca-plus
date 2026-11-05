import { describe, expect, it, vi } from 'vitest'
import type { PulseDecision, PulsePerson, PulseWaiting } from '../../shared/pulse-types'
import { createHqBrain } from './hq-brain'
import { hqBrainPersonOfTarget, type HqBrainPulse } from './hq-brain-rows'

const ANN: PulsePerson = {
  id: 'p-ann',
  name: 'Ann',
  slackUserId: 'U-ANN',
  clickupUserId: null,
  role: null,
  notes: null,
  createdAt: 0,
  updatedAt: 0
}

function wait(partial: Partial<PulseWaiting> & { id: string; title: string }): PulseWaiting {
  return {
    direction: 'on-them',
    personId: ANN.id,
    project: 'acme',
    detail: null,
    source: 'agent',
    sourceRef: null,
    status: 'open',
    dueAt: null,
    resolution: null,
    createdAt: 1_000,
    resolvedAt: null,
    agentSessionId: null,
    paneKey: null,
    worktreeId: null,
    reply: null,
    replyAuthor: null,
    replyTs: null,
    repliedAt: null,
    replyDeliveredAt: null,
    ...partial
  } as PulseWaiting
}

function decision(partial: Partial<PulseDecision> & { id: string; title: string }): PulseDecision {
  return {
    kind: 'approval',
    body: null,
    outcome: 'approved',
    project: null,
    personId: null,
    draftId: null,
    source: 'outgoing',
    decidedAt: 0,
    mirroredPath: null,
    sentContext: null,
    ...partial
  }
}

const TIMELINE = {
  entity: 'DEV-123',
  matched_by: 'id',
  ms: 40,
  rows: [
    {
      ts: '2026-10-29T21:47:04+03:00',
      day: '2026-10-29',
      key: 'decisions:d-cmd',
      source: 'pulse:decisions',
      project: 'acme',
      title: 'remote · delete on a server or database — DEV-123 — approved',
      link: null,
      atom: null,
      mentions: 1,
      text: 'ssh host …'
    },
    {
      ts: '2026-10-27T20:08:32+03:00',
      day: '2026-10-27',
      key: 'decisions:d-dm',
      source: 'pulse:decisions',
      project: 'acme',
      title: 'Slack · send message — DEV-123 — rejected',
      link: null,
      atom: null,
      mentions: 1,
      text: 'Ann, stage 1 is done'
    },
    {
      ts: '2026-10-27T20:08:26+03:00',
      day: '2026-10-27',
      key: 'waitings:w-closed',
      source: 'pulse:waitings',
      project: 'acme',
      title: 'Waiting: DEV-123 ok to split',
      link: null,
      atom: null,
      mentions: 1,
      text: 'ok to split'
    },
    {
      ts: '2026-10-27T16:45:06+03:00',
      day: '2026-10-27',
      key: 'claude_aa_bb',
      source: 'orca-chat',
      project: 'acme',
      title: 'Handoff',
      link: 'orca-session:claude_aa_bb',
      atom: 'fact',
      mentions: 3,
      text: 'Ann put the module on prod.'
    },
    {
      ts: '2026-10-27T13:00:00+03:00',
      day: '2026-10-27',
      key: 'clickup:DEV-123',
      source: 'clickup',
      project: null,
      title: 'DEV-123 T3 · Prod data for the agent',
      link: 'https://app.clickup.example/t/abc',
      atom: null,
      mentions: 1,
      text: 'task text'
    }
  ]
}

function brain(run: (script: string, args: string[]) => Promise<string>) {
  const pulse: HqBrainPulse = {
    waitings: () => [
      wait({ id: 'w-closed', title: 'DEV-123 ok to split', status: 'resolved', resolution: 'yes' }),
      wait({ id: 'w-open', title: 'DEV-123: the token', createdAt: 2_000 }),
      wait({ id: 'w-other', title: 'DEV-999: unrelated' })
    ],
    decisions: () => [
      decision({ id: 'd-cmd', title: 'remote · delete on a server or database' }),
      decision({
        id: 'd-dm',
        title: 'Slack · send message',
        outcome: 'rejected',
        sentContext: {
          targetName: 'DM with Ann Lee',
          targetId: 'U-ANN',
          agentSessionId: 'claude_cc',
          worktreeId: 'repo::/x'
        } as PulseDecision['sentContext']
      })
    ],
    people: () => [ANN]
  }
  return createHqBrain({
    hqPath: () => '/hq',
    run,
    pulse,
    sessionWorkspace: (sessionId) => (sessionId === 'claude_aa_bb' ? 'repo::/acme' : null),
    now: () => 0,
    exists: () => true
  })
}

describe('createHqBrain', () => {
  it('runs the timeline and adds what Pulse knows', async () => {
    const run = vi.fn(async () => JSON.stringify(TIMELINE))
    const result = await brain(run).look('DEV-123')
    expect(run).toHaveBeenCalledWith('/hq/scripts/hq_brain.py', [
      '--hq',
      '/hq',
      'timeline',
      'DEV-123',
      '--json',
      '--limit',
      '150'
    ])
    const byKey = new Map(result.rows.map((row) => [row.key, row]))
    expect(byKey.get('decisions:d-cmd')?.command).toBe(true)
    expect(byKey.get('decisions:d-dm')).toMatchObject({
      status: { kind: 'sent', outcome: 'rejected' },
      person: 'Ann',
      target: 'DM with Ann Lee',
      chat: { sessionId: 'claude_cc', worktreeId: 'repo::/x' },
      command: false
    })
    expect(byKey.get('waitings:w-closed')).toMatchObject({
      status: { kind: 'wait', status: 'resolved', resolution: 'yes' },
      person: 'Ann'
    })
    expect(byKey.get('claude_aa_bb')?.chat).toEqual({
      sessionId: 'claude_aa_bb',
      worktreeId: 'repo::/acme'
    })
    expect(result.head).toEqual({
      kind: 'task',
      title: 'T3 · Prod data for the agent',
      link: 'https://app.clickup.example/t/abc',
      project: 'acme'
    })
    expect(result.waiting.map((w) => w.id)).toEqual(['w-open'])
    expect(result.closedWaits).toBe(1)
    expect(result.people).toEqual([{ name: 'Ann', count: 3 }])
  })

  it('goes to the ranked search for long free text, and when words match no row', async () => {
    const hits = JSON.stringify({ ms: 5, hits: [] })
    const run = vi.fn(async (_script: string, args: string[]) =>
      args[2] === 'timeline' ? JSON.stringify({ matched_by: 'words', ms: 1, rows: [] }) : hits
    )
    const service = brain(run)
    expect((await service.look('dry run on prod')).mode).toBe('search')
    expect(run).toHaveBeenLastCalledWith('/hq/scripts/hq_brain.py', [
      '--hq',
      '/hq',
      'search',
      'dry run on prod',
      '--json',
      '--limit',
      '40'
    ])
    expect((await service.look('Bob')).mode).toBe('search')
  })

  it('answers the same query from its cache for a minute', async () => {
    const run = vi.fn(async () => JSON.stringify(TIMELINE))
    const service = brain(run)
    await service.look('DEV-123')
    await service.look(' DEV-123 ')
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('says what is missing when HQ is not set', async () => {
    const service = createHqBrain({
      hqPath: () => null,
      run: async () => '',
      pulse: { waitings: () => [], decisions: () => [], people: () => [] },
      sessionWorkspace: () => null,
      now: () => 0
    })
    await expect(service.look('DEV-1')).rejects.toThrow(/HQ is not set/)
  })
})

describe('hqBrainPersonOfTarget', () => {
  it('names the person of a DM and nobody for a channel', () => {
    expect(hqBrainPersonOfTarget('DM with Ann')).toBe('Ann')
    expect(hqBrainPersonOfTarget('DM Bob')).toBe('Bob')
    expect(hqBrainPersonOfTarget('Slack DM Bob (D098DBZKLJX)')).toBeNull()
    expect(hqBrainPersonOfTarget('#general')).toBeNull()
  })
})
