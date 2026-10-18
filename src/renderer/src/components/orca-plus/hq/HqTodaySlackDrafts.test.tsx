// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HqSlackScoutDraft } from '../../../../../shared/hq-slack-scout'

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string, options?: Record<string, string>) =>
    fallback.replace('{{value0}}', options?.value0 ?? '')
}))
vi.mock('./HqCommandDictation', () => ({ HqCommandDictation: () => null }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }))
vi.mock('./use-hq-project-pages', () => ({
  useHqProjectPages: () => ({
    status: 'ready',
    pages: [
      { repoId: 'r1', slug: 'acme_support_service', title: 'acme_support_service — Zenith' },
      { repoId: 'r2', slug: 'acme-flows', title: 'Billing — робот' }
    ]
  })
}))
vi.mock('./hq-view', () => ({ openHqScreen: vi.fn() }))
vi.mock('@/store', () => ({
  useAppStore: { getState: () => ({ repos: [], worktreesByRepo: {}, settings: {} }) }
}))
vi.mock('@/runtime/runtime-clickup-client', () => ({}))
vi.mock('./hq-today-actions', () => ({ findHqWorktreeId: () => null, launchHqCommand: vi.fn() }))
vi.mock('./hq-take-launch', () => ({ launchHqTakeInRepo: vi.fn() }))
vi.mock('./hq-triage-decisions', () => ({ rememberHqTake: vi.fn() }))
vi.mock('./use-hq-project-clickup', () => ({ readHqClickUpSourceContext: () => null }))

const { HqTodaySlackDrafts } = await import('./HqTodaySlackDrafts')

const draft: HqSlackScoutDraft = {
  id: 'C1:1',
  channelName: 'acme-bugs',
  author: 'Nora',
  permalink: 'https://slack/p',
  quote: 'the cart is broken',
  title: 'Fix the cart',
  description: '## Зачем',
  foundAt: ''
}

const api = {
  slackDrafts: vi.fn(),
  createSlackDraftTask: vi.fn(async () => ({ ok: true as const, taskUrl: 'https://cu/t/1' })),
  rejectSlackDraft: vi.fn(async () => ({ ok: true as const })),
  answerSlackDraft: vi.fn(async () => ({ ok: true as const })),
  editSlackDraft: vi.fn(async () => ({ ok: true as const }))
}

const request: HqSlackScoutDraft = {
  ...draft,
  id: 'D1:2',
  author: 'Вера',
  kind: 'answer',
  ask: 'проверь тикеты',
  project: 'acme_support_service',
  title: 'Проверить тикеты',
  quote: 'Владелец, проверь тикеты'
}

beforeEach(() => {
  api.slackDrafts.mockResolvedValue({
    ok: true,
    configured: true,
    lastRunAt: null,
    failedAt: null,
    drafts: [draft]
  })
  vi.stubGlobal('api', { hqProjects: api, shell: { openUrl: vi.fn() } })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

describe('HqTodaySlackDrafts', () => {
  it('stays away until the scout is set up', async () => {
    api.slackDrafts.mockResolvedValue({
      ok: true,
      configured: false,
      lastRunAt: null,
      failedAt: null,
      drafts: []
    })
    render(<HqTodaySlackDrafts />)
    await waitFor(() => expect(api.slackDrafts).toHaveBeenCalled())
    expect(screen.queryByText('From Slack')).toBeNull()
  })

  it('says so when the last scout run failed', async () => {
    api.slackDrafts.mockResolvedValue({
      ok: true,
      configured: true,
      lastRunAt: null,
      failedAt: '2026-10-06T17:07:38Z',
      drafts: [draft]
    })
    render(<HqTodaySlackDrafts />)
    expect(await screen.findByText(/The scout did not run at/)).toBeTruthy()
  })

  describe('as Slack requests', () => {
    beforeEach(() => {
      api.slackDrafts.mockResolvedValue({
        ok: true,
        configured: true,
        lastRunAt: null,
        failedAt: null,
        drafts: [request, draft]
      })
    })

    it('shows who asks what for which project, the suggested answer first', async () => {
      render(<HqTodaySlackDrafts />)
      expect(await screen.findByText('проверь тикеты')).toBeTruthy()
      expect(screen.getByText('acme_support_service · acme-bugs')).toBeTruthy()
      // A draft from before requests had a kind reads as a task with no project.
      expect(screen.getByText('project? · acme-bugs')).toBeTruthy()
      const [first, second] = screen.getAllByRole('listitem')
      expect(first?.querySelectorAll('button')[0]?.textContent).toBe('Just reply')
      expect(second?.querySelectorAll('button')[0]?.textContent).toBe('Do')
    })

    it('Do on a request with no project asks for the project before anything is created', async () => {
      render(<HqTodaySlackDrafts />)
      await screen.findByText('проверь тикеты')
      const second = screen.getAllByRole('listitem')[1]
      fireEvent.click(second!.querySelectorAll('button')[0]!)
      expect(await screen.findByRole('textbox', { name: 'What they ask' })).toBeTruthy()
      expect(api.createSlackDraftTask).not.toHaveBeenCalled()
      // Cancel lets go of the editor the bell or Do asked for.
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
      await waitFor(() =>
        expect(screen.queryByRole('textbox', { name: 'What they ask' })).toBeNull()
      )
    })

    it('Just reply without the HQ workspace opens the thread and records the answer', async () => {
      render(<HqTodaySlackDrafts />)
      fireEvent.click((await screen.findAllByRole('button', { name: 'Just reply' }))[0]!)
      await waitFor(() => expect(api.answerSlackDraft).toHaveBeenCalledWith({ id: 'D1:2' }))
      expect(window.api.shell.openUrl).toHaveBeenCalledWith('https://slack/p')
      expect(api.createSlackDraftTask).not.toHaveBeenCalled()
      await waitFor(() => expect(screen.queryByText('проверь тикеты')).toBeNull())
    })

    it('Edit saves the corrected kind, project and ask', async () => {
      render(<HqTodaySlackDrafts />)
      fireEvent.click((await screen.findAllByRole('button', { name: 'Edit' }))[0]!)
      fireEvent.change(screen.getByRole('textbox', { name: 'What they ask' }), {
        target: { value: 'проверить тикеты Зенита' }
      })
      fireEvent.click(screen.getByRole('button', { name: 'Save' }))
      await waitFor(() =>
        expect(api.editSlackDraft).toHaveBeenCalledWith({
          id: 'D1:2',
          kind: 'answer',
          project: 'acme_support_service',
          ask: 'проверить тикеты Зенита',
          title: 'Проверить тикеты',
          description: '## Зачем'
        })
      )
      await waitFor(() => expect(api.slackDrafts).toHaveBeenCalledTimes(2))
    })

    it('Skip records the rejection', async () => {
      render(<HqTodaySlackDrafts />)
      fireEvent.click((await screen.findAllByRole('button', { name: 'Skip' }))[0]!)
      await waitFor(() => expect(api.rejectSlackDraft).toHaveBeenCalledWith({ id: 'D1:2' }))
    })
  })
})
