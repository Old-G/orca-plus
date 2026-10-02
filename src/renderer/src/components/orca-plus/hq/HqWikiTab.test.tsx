// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/i18n/i18n', () => ({ translate: (_key: string, fallback: string) => fallback }))
vi.mock('@/store', () => {
  const state = () => ({ settings: { hqPath: '/hq' } })
  const useAppStore = (selector: (s: ReturnType<typeof state>) => unknown) => selector(state())
  useAppStore.getState = state
  return { useAppStore }
})
vi.mock('@/components/sidebar/CommentMarkdown', () => ({
  default: ({ content }: { content: string }) => <div>{content}</div>
}))

import { HqWikiTab } from './HqWikiTab'

const PAGES: Record<string, string> = {
  'wiki/index.md': '# HQ index\n\nIndex body',
  'wiki/garden.md': '# Garden\n\nGarden body'
}

beforeEach(() => {
  Object.assign(window, {
    api: {
      hqProjects: {
        wikiTree: vi.fn(async () => ({
          ok: true,
          entries: [
            { path: 'wiki/index.md', title: 'HQ index' },
            { path: 'wiki/garden.md', title: 'Garden' }
          ]
        })),
        wikiPage: vi.fn(async (path: string) => ({ ok: true, markdown: PAGES[path] ?? '' }))
      }
    }
  })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('HqWikiTab at narrow widths', () => {
  it('shows the page first, the tree on Pages, and the page again once one is picked', async () => {
    render(<HqWikiTab />)
    await screen.findByText(/Index body/)
    const nav = screen.getByRole('navigation', { name: 'HQ pages' })
    const article = screen.getByRole('article')
    expect(nav.getAttribute('data-open')).toBe('false')
    expect(article.getAttribute('data-open')).toBe('false')

    fireEvent.click(screen.getByRole('button', { name: 'HQ pages' }))
    expect(nav.getAttribute('data-open')).toBe('true')
    expect(article.getAttribute('data-open')).toBe('true')

    fireEvent.click(screen.getByRole('button', { name: 'Garden' }))
    expect(nav.getAttribute('data-open')).toBe('false')
    await screen.findByText(/Garden body/)
  })
})
