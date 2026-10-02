// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DashboardCard } from '../../../../../shared/dashboard-snapshot'

const mocks = vi.hoisted(() => ({
  send: vi.fn(async (): Promise<{ ok: true } | { ok: false; message: string }> => ({ ok: true })),
  launch: vi.fn((): { ok: true } | { ok: false; message: string } => ({ ok: true })),
  reveal: vi.fn()
}))

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string, options?: Record<string, string>) =>
    fallback
      .replace('{{value0}}', options?.value0 ?? '')
      .replace('{{value1}}', options?.value1 ?? '')
}))
vi.mock('../../dashboard/reveal-dashboard-agent', () => ({ revealDashboardAgent: mocks.reveal }))
vi.mock('./hq-today-actions', () => ({
  sendHqAgentMessage: mocks.send,
  launchHqCommand: mocks.launch
}))

import { HqTodayAgents, HqTodayWaitings } from './HqTodayPeople'

function card(paneKey: string, extra: Partial<DashboardCard>): DashboardCard {
  return {
    paneKey,
    ptyId: null,
    agentType: 'claude',
    bucket: 'done',
    dotState: 'done',
    task: paneKey,
    repoId: 'r',
    worktreeId: 'w',
    tabId: 't',
    leafId: null,
    repoName: 'shop',
    worktreeName: 'main',
    startedAt: 0,
    finishedAt: 1,
    stateChangedAt: 1,
    unseen: true,
    ...extra
  }
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('HQ Today people', () => {
  it('nudges a finished agent and opens one that waits on the user', async () => {
    render(
      <HqTodayAgents
        cards={[
          card('asks', { bucket: 'attention', task: 'Deploy?', askSummary: 'May I push?' }),
          card('done', { task: 'Report', lastAgentMessage: 'All green.' }),
          card('busy', { bucket: 'working' })
        ]}
        now={10}
      />
    )
    expect(screen.getByText('1 working now.')).toBeTruthy()
    const asks = screen.getByText('Deploy?').closest('li')!
    expect(within(asks).getByText('May I push?')).toBeTruthy()
    expect(within(asks).queryByRole('button', { name: 'Continue' })).toBeNull()
    fireEvent.click(within(asks).getByRole('button', { name: 'Open' }))
    expect(mocks.reveal).toHaveBeenCalledWith(expect.objectContaining({ worktreeId: 'w' }))

    const done = screen.getByText('Report').closest('li')!
    fireEvent.click(within(done).getByRole('button', { name: 'Continue' }))
    expect(mocks.send).toHaveBeenCalledWith(
      expect.objectContaining({ paneKey: 'done' }),
      'Continue'
    )
    expect(await within(done).findByText('Sent.')).toBeTruthy()
  })

  it('shows five finished agents and the rest on request', () => {
    render(
      <HqTodayAgents
        cards={Array.from({ length: 7 }, (_, index) =>
          card(`done-${index}`, { task: `Run ${index}`, finishedAt: index })
        )}
        now={10}
      />
    )
    expect(screen.getByText('Finished, not read · 7')).toBeTruthy()
    expect(screen.getAllByRole('button', { name: 'Continue' })).toHaveLength(5)
    fireEvent.click(screen.getByRole('button', { name: 'Show 2 more' }))
    expect(screen.getAllByRole('button', { name: 'Continue' })).toHaveLength(7)
  })

  it('says why a nudge failed', async () => {
    mocks.send.mockResolvedValueOnce({ ok: false, message: 'This agent is no longer open.' })
    render(<HqTodayAgents cards={[card('done', { task: 'Report' })]} now={10} />)
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(await screen.findByText('This agent is no longer open.')).toBeTruthy()
  })

  it('reminds the person I wait on through a Claude run in HQ', async () => {
    render(
      <HqTodayWaitings
        waitings={[
          {
            id: 'w1',
            direction: 'on-them',
            title: 'Send the price list',
            personId: 'p1',
            project: null,
            dueAt: null,
            createdAt: 1
          },
          {
            id: 'w2',
            direction: 'on-me',
            title: 'Review the deck',
            personId: null,
            project: null,
            dueAt: null,
            createdAt: 1
          }
        ]}
        people={[{ id: 'p1', name: 'Ann' }]}
        hqWorktreeId="hq::/hq"
        now={10}
      />
    )
    expect(screen.getAllByRole('button', { name: 'Remind' })).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Remind' }))
    await waitFor(() => expect(mocks.launch).toHaveBeenCalledTimes(1))
    expect(mocks.launch.mock.calls[0]).toEqual([
      'hq::/hq',
      expect.stringContaining('Remind Ann about: “Send the price list”')
    ])
  })

  it('cannot remind without the HQ workspace', () => {
    render(
      <HqTodayWaitings
        waitings={[
          {
            id: 'w1',
            direction: 'on-them',
            title: 'x',
            personId: null,
            project: null,
            dueAt: null,
            createdAt: 1
          }
        ]}
        people={[]}
        hqWorktreeId={null}
        now={10}
      />
    )
    expect(screen.getByRole('button', { name: 'Remind' }).hasAttribute('disabled')).toBe(true)
  })
})
