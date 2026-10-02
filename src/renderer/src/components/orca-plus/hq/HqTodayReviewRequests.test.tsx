// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/i18n/i18n', () => ({ translate: (_key: string, fallback: string) => fallback }))

import { HqTodayReviewRequests } from './HqTodayReviewRequests'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('HqTodayReviewRequests', () => {
  it('lists reviews, shows a failed source, refreshes, and opens one in the browser', async () => {
    const reviews = vi.fn(async (_refresh?: boolean) => ({
      reviews: [
        {
          provider: 'gitlab' as const,
          ref: 'team/api!34',
          title: 'Add route',
          url: 'https://gitlab.com/team/api/-/merge_requests/34',
          author: 'bob',
          draft: true,
          updatedAt: 1
        }
      ],
      errors: ['GitHub: not logged in']
    }))
    const openUrl = vi.fn(async () => {})
    Object.assign(window, { api: { hqProjects: { reviews }, shell: { openUrl } } })
    render(<HqTodayReviewRequests now={10} />)

    expect(await screen.findByText('Add route')).toBeTruthy()
    expect(screen.getByText('team/api!34 · bob · draft')).toBeTruthy()
    expect(screen.getByText('GitHub: not logged in')).toBeTruthy()
    expect(reviews).toHaveBeenLastCalledWith(false)

    fireEvent.click(screen.getByRole('button', { name: /Add route/ }))
    expect(openUrl).toHaveBeenCalledWith('https://gitlab.com/team/api/-/merge_requests/34')

    fireEvent.click(screen.getByRole('button', { name: 'Refresh reviews' }))
    await waitFor(() => expect(reviews).toHaveBeenLastCalledWith(true))
    expect(await screen.findByText('Add route')).toBeTruthy()
  })
})
