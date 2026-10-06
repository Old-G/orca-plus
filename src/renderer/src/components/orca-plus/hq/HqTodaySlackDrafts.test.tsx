// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HqSlackScoutDraft } from '../../../../../shared/hq-slack-scout'

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string, options?: Record<string, string>) =>
    fallback.replace('{{value0}}', options?.value0 ?? '')
}))
vi.mock('./HqCommandDictation', () => ({ HqCommandDictation: () => null }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const { HqTodaySlackDrafts } = await import('./HqTodaySlackDrafts')

const draft: HqSlackScoutDraft = {
  id: 'C1:1',
  channelName: 'lh-bugs',
  author: 'Laure',
  permalink: 'https://slack/p',
  quote: 'the cart is broken',
  title: 'Fix the cart',
  description: '## Зачем',
  foundAt: ''
}

const api = {
  slackDrafts: vi.fn(),
  createSlackDraftTask: vi.fn(async () => ({ ok: true as const, taskUrl: 'https://cu/t/1' })),
  rejectSlackDraft: vi.fn(async () => ({ ok: true as const }))
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

  it('creates the task from the draft as the owner edited it', async () => {
    render(<HqTodaySlackDrafts />)
    fireEvent.click(await screen.findByRole('button', { name: 'Review draft' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Task title' }), {
      target: { value: 'Fix the cart checkout' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create task' }))
    await waitFor(() =>
      expect(api.createSlackDraftTask).toHaveBeenCalledWith({
        id: 'C1:1',
        title: 'Fix the cart checkout',
        description: '## Зачем'
      })
    )
    await waitFor(() => expect(screen.queryByText('Fix the cart')).toBeNull())
  })

  it('rejects a draft for good without creating anything', async () => {
    render(<HqTodaySlackDrafts />)
    fireEvent.click(await screen.findByRole('button', { name: 'Reject' }))
    await waitFor(() => expect(api.rejectSlackDraft).toHaveBeenCalledWith({ id: 'C1:1' }))
    expect(api.createSlackDraftTask).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.getByText('Nothing new from Slack.')).toBeTruthy())
  })
})
