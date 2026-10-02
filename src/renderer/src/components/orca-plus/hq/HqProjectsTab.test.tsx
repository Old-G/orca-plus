// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HqProjectPagesState } from './use-hq-project-pages'

const mocks = vi.hoisted(() => {
  const offPages = (): HqProjectPagesState => ({ status: 'off' })
  return {
    activate: vi.fn(),
    reveal: vi.fn(),
    addWaiting: vi.fn(async () => {}),
    history: vi.fn(async () => ({
      items: [
        {
          id: 'c1',
          displayId: 'abc1234',
          parentIds: [],
          subject: 'Fix cart',
          message: '',
          timestamp: 2_000
        }
      ],
      hasIncomingChanges: false,
      hasOutgoingChanges: false,
      hasMore: false,
      limit: 10
    })),
    pages: offPages(),
    state: {
      repos: [
        {
          id: 'shop',
          path: '/shop',
          displayName: 'shop',
          badgeColor: '#000',
          addedAt: 1,
          projectGroupId: 'work'
        },
        {
          id: 'blank',
          path: '/blank',
          displayName: 'blank',
          badgeColor: '#000',
          addedAt: 1,
          projectGroupId: null
        }
      ],
      projectGroups: [
        {
          id: 'work',
          name: 'Work',
          parentPath: null,
          parentGroupId: null,
          createdFrom: 'manual',
          tabOrder: 0,
          isCollapsed: false,
          color: null,
          createdAt: 1,
          updatedAt: 1
        }
      ],
      worktreesByRepo: {
        shop: [
          {
            id: 'shop::/main',
            repoId: 'shop',
            path: '/shop',
            branch: 'refs/heads/main',
            displayName: 'main',
            isArchived: false,
            isMainWorktree: true,
            lastActivityAt: Date.now() - 3 * 3_600_000
          }
        ]
      }
    }
  }
})

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string, options?: Record<string, string>) =>
    fallback.replace('{{value0}}', options?.value0 ?? '')
}))
vi.mock('@/store', () => ({
  useAppStore: Object.assign(
    (selector: (s: typeof mocks.state) => unknown) => selector(mocks.state),
    { getState: () => mocks.state }
  )
}))
vi.mock('@/lib/worktree-activation', () => ({ activateAndRevealWorkspace: mocks.activate }))
vi.mock('../../dashboard/reveal-dashboard-agent', () => ({ revealDashboardAgent: mocks.reveal }))
vi.mock('@/runtime/runtime-git-client', () => ({ getRuntimeGitHistory: mocks.history }))
vi.mock('@/store/repos/owner-routing', () => ({ settingsForRepoOwner: () => null }))
vi.mock('@/lib/connection-context', () => ({ getConnectionId: () => null }))
vi.mock('./HqProjectTasks', () => ({ HqProjectTasks: () => null }))
vi.mock('@/components/sidebar/CommentMarkdown', () => ({
  default: ({
    content,
    onLinkClick
  }: {
    content: string
    onLinkClick: (event: { preventDefault: () => void }, href: string) => void
  }) => (
    <div>
      <p>{content}</p>
      <button
        type="button"
        onClick={() => onLinkClick({ preventDefault: () => {} }, 'blank-slug.md')}
      >
        related
      </button>
    </div>
  )
}))
vi.mock('../../dashboard/useLiveDashboardSnapshot', () => ({
  useLiveDashboardSnapshot: () => ({
    generatedAt: 1,
    cards: [
      {
        repoId: 'shop',
        worktreeId: 'shop::/main',
        tabId: 't',
        leafId: null,
        bucket: 'attention',
        paneKey: 'a',
        task: 'Review the cart',
        worktreeName: 'main',
        stateChangedAt: 1
      },
      { repoId: 'shop', bucket: 'working', paneKey: 'b', task: 'Write tests', stateChangedAt: 2 }
    ],
    workspaces: [
      { repoId: 'shop', worktreeId: 'shop::/main', review: { number: 4, state: 'open' } }
    ]
  })
}))
vi.mock('./use-hq-pulse', () => ({
  useHqPulse: () => ({
    status: 'ready',
    pulse: {
      people: [],
      decisions: [
        {
          id: 'd',
          kind: 'decision',
          title: 'Keep the old checkout',
          outcome: null,
          project: 'shop-slug',
          decidedAt: 3_000
        },
        {
          id: 'e',
          kind: 'decision',
          title: 'Other project call',
          outcome: null,
          project: 'blog',
          decidedAt: 4_000
        }
      ],
      waitings: [{ id: 'w', direction: 'on-me', title: 'x', project: 'shop-slug', createdAt: 1 }]
    }
  }),
  addHqWaiting: mocks.addWaiting,
  closeHqWaiting: vi.fn()
}))
vi.mock('./use-hq-project-pages', () => ({ useHqProjectPages: () => mocks.pages }))

import { HqProjectsTab } from './HqProjectsTab'

const SHOP_PAGE = {
  repoId: 'shop',
  slug: 'shop-slug',
  title: 'Shop — the storefront',
  status: 'active',
  group: null,
  relations: []
}
const BLANK_PAGE = { ...SHOP_PAGE, repoId: 'blank', slug: 'blank-slug', title: 'Blank' }

beforeEach(() => {
  Object.assign(window, {
    api: { hqProjects: { wikiPage: vi.fn(async () => ({ ok: false, error: 'none' })) } }
  })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  mocks.pages = { status: 'off' }
})

describe('HqProjectsTab', () => {
  it('shows each group with its project cards, and opens a project on click', () => {
    mocks.pages = {
      status: 'ready',
      pages: [
        {
          repoId: 'shop',
          slug: 'shop-slug',
          title: 'Shop — the storefront',
          status: 'active',
          group: null,
          relations: []
        }
      ]
    }
    render(<HqProjectsTab />)
    const work = screen.getByRole('region', { name: 'Work' })
    const card = within(work).getByRole('button', { name: /shop/ })
    expect(card.textContent).toContain('the storefront')
    expect(card.textContent).toContain('active')
    expect(card.textContent).toContain('1 waiting on you')
    expect(card.textContent).toContain('1 working')
    expect(card.textContent).toContain('1 in review')
    expect(card.textContent).toContain('Waitings: 1')
    expect(card.textContent).toContain('Workspaces: 1')
    expect(card.textContent).toContain('3h')
    expect(screen.queryByText(/Set an HQ folder/)).toBeNull()

    fireEvent.click(card)
    expect(screen.getByRole('button', { name: /All projects/ })).toBeTruthy()
    expect(mocks.activate).not.toHaveBeenCalled()
  })

  it('says when no HQ folder is set', () => {
    render(<HqProjectsTab />)
    expect(screen.getByText(/Set an HQ folder/)).toBeTruthy()
    // Why: with no HQ pages there is no slug, so the shop card cannot claim the waiting.
    expect(screen.getByRole('button', { name: /shop/ }).textContent).not.toContain('Waitings')
  })

  it('opens a project card with its page, agents, waitings, workspaces and feed', async () => {
    mocks.pages = { status: 'ready', pages: [SHOP_PAGE, BLANK_PAGE] }
    const wikiPage = vi.fn(async (path: string) => ({
      ok: true,
      markdown: `---\nproject: x\n---\n# Page of ${path}`
    }))
    const projectDiagram = vi.fn(async () => ({
      ok: true,
      html: '<p>diagram</p>',
      name: 'system.html'
    }))
    Object.assign(window, { api: { hqProjects: { wikiPage, projectDiagram } } })
    render(<HqProjectsTab />)
    fireEvent.click(screen.getByRole('button', { name: /shop/ }))

    expect(await screen.findByText('# Page of projects/shop-slug.md')).toBeTruthy()

    const agents = screen.getByRole('region', { name: 'Agents' })
    const agentRows = within(agents).getAllByRole('button')
    expect(agentRows[0].textContent).toContain('Review the cart')
    expect(agentRows[0].textContent).toContain('Needs You')
    fireEvent.click(agentRows[0])
    expect(mocks.reveal).toHaveBeenCalledWith(
      expect.objectContaining({ repoId: 'shop', worktreeId: 'shop::/main', tabId: 't' })
    )

    const waitings = screen.getByRole('region', { name: 'Waitings' })
    expect(within(waitings).getByText('x')).toBeTruthy()
    const [onMeTitle] = within(waitings).getAllByLabelText('What is waiting')
    fireEvent.change(onMeTitle, { target: { value: 'Send the price list' } })
    fireEvent.click(within(waitings).getAllByRole('button', { name: 'Add' })[0])
    await waitFor(() =>
      expect(mocks.addWaiting).toHaveBeenCalledWith(
        expect.objectContaining({
          direction: 'on-me',
          title: 'Send the price list',
          project: 'shop-slug'
        })
      )
    )

    const workspaces = screen.getByRole('region', { name: 'Workspaces' })
    const workspace = within(workspaces).getByRole('button', { name: /main/ })
    expect(workspace.textContent).toContain('#4 in review')
    fireEvent.click(workspace)
    expect(mocks.activate).toHaveBeenCalledWith('shop::/main')

    const feed = screen.getByRole('region', { name: 'Feed' })
    await within(feed).findByText('Fix cart')
    const rows = within(feed)
      .getAllByRole('listitem')
      .map((row) => row.textContent)
    expect(rows[0]).toContain('Keep the old checkout')
    expect(rows[1]).toContain('abc1234')
    expect(within(feed).queryByText('Other project call')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Show the map' }))
    expect(await screen.findByTitle('Map')).toBeTruthy()
    expect(projectDiagram).toHaveBeenCalledWith('shop')

    fireEvent.click(screen.getByRole('button', { name: 'Open' }))
    expect(mocks.activate).toHaveBeenLastCalledWith('shop::/main')

    // A related project's link opens that project's card.
    fireEvent.click(screen.getByRole('button', { name: 'related' }))
    expect(await screen.findByText('# Page of projects/blank-slug.md')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Open' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByText(/No git checkout/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /All projects/ }))
    expect(screen.getByRole('region', { name: 'Work' })).toBeTruthy()
  })

  it('says waitings cannot be tied to a project HQ has no page for', () => {
    render(<HqProjectsTab />)
    fireEvent.click(screen.getByRole('button', { name: /shop/ }))
    expect(screen.getByText(/no page for this project yet, so waitings/)).toBeTruthy()
    expect(screen.queryByLabelText('What is waiting')).toBeNull()
  })
})
