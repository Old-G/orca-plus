import { describe, expect, it } from 'vitest'
import type { DashboardCard, DashboardWorkspace } from '../../../../../shared/dashboard-snapshot'
import type { ProjectGroup } from '../../../../../shared/project-group-types'
import type { Repo } from '../../../../../shared/repo-types'
import type { Worktree } from '../../../../../shared/worktree/types'
import { buildHqProjectBoard, type HqProjectBoardInput } from './hq-project-board'
import type { HqWaiting } from './hq-pulse-snapshot'

function group(id: string, name: string, overrides: Partial<ProjectGroup> = {}): ProjectGroup {
  return {
    id,
    name,
    parentPath: null,
    parentGroupId: null,
    createdFrom: 'manual',
    tabOrder: 0,
    isCollapsed: false,
    color: null,
    createdAt: 1,
    updatedAt: 1,
    ...overrides
  }
}

function repo(id: string, projectGroupId: string | null, overrides: Partial<Repo> = {}): Repo {
  return {
    id,
    path: `/${id}`,
    displayName: id,
    badgeColor: '#000',
    addedAt: 1,
    projectGroupId,
    ...overrides
  }
}

function worktree(repoId: string, name: string, overrides: Partial<Worktree> = {}): Worktree {
  return {
    id: `${repoId}::/${name}`,
    repoId,
    displayName: name,
    comment: '',
    linkedIssue: null,
    linkedPR: null,
    linkedLinearIssue: null,
    isArchived: false,
    isUnread: false,
    isPinned: false,
    sortOrder: 0,
    lastActivityAt: 0,
    path: `/${name}`,
    head: 'HEAD',
    branch: name,
    isBare: false,
    isMainWorktree: false,
    ...overrides
  }
}

function card(repoId: string, bucket: DashboardCard['bucket'], paneKey: string): DashboardCard {
  return {
    paneKey,
    ptyId: null,
    agentType: 'claude',
    bucket,
    dotState: bucket === 'attention' ? 'waiting' : 'working',
    task: 't',
    repoId,
    worktreeId: `${repoId}::/main`,
    tabId: 'tab',
    leafId: null,
    repoName: repoId,
    worktreeName: 'main',
    startedAt: 0,
    finishedAt: null,
    stateChangedAt: 0,
    unseen: false
  }
}

function workspace(repoId: string, review: DashboardWorkspace['review']): DashboardWorkspace {
  return {
    repoId,
    worktreeId: `${repoId}::/x`,
    repoName: repoId,
    worktreeName: 'x',
    hostKind: 'local',
    executionHostId: 'local',
    workspaceKind: 'worktree',
    ...(review ? { review } : {})
  }
}

function waiting(id: string, project: string | null): HqWaiting {
  return {
    id,
    direction: 'on-me',
    title: id,
    personId: null,
    project,
    dueAt: null,
    createdAt: 1
  }
}

function input(overrides: Partial<HqProjectBoardInput>): HqProjectBoardInput {
  return {
    repos: [],
    projectGroups: [],
    worktreesByRepo: {},
    snapshot: { cards: [] },
    waitings: [],
    pages: [],
    ...overrides
  }
}

describe('buildHqProjectBoard', () => {
  it('lists groups in sidebar order, nested ones after their parent, ungrouped last, empty ones never', () => {
    const sections = buildHqProjectBoard(
      input({
        projectGroups: [
          group('work', 'Work', { tabOrder: 1 }),
          group('home', 'Home', { tabOrder: 0 }),
          group('live', 'Live', { parentGroupId: 'work' }),
          group('empty', 'Empty', { tabOrder: 2 })
        ],
        repos: [
          repo('shop', 'live'),
          repo('blog', 'home'),
          repo('api', 'work', { projectGroupOrder: 2 }),
          repo('cli', 'work', { projectGroupOrder: 1 }),
          repo('loose', null),
          repo('orphan', 'deleted-group')
        ]
      })
    )
    expect(sections.map((section) => [section.name, section.projects.map((p) => p.name)])).toEqual([
      ['Home', ['blog']],
      ['Work', ['cli', 'api']],
      ['Work / Live', ['shop']],
      [null, ['loose', 'orphan']]
    ])
  })

  it('still shows the projects of groups caught in a parent cycle', () => {
    const sections = buildHqProjectBoard(
      input({
        projectGroups: [
          group('a', 'A', { parentGroupId: 'b' }),
          group('b', 'B', { parentGroupId: 'a' })
        ],
        repos: [repo('one', 'a'), repo('two', 'b')]
      })
    )
    expect(sections.flatMap((section) => section.projects.map((p) => p.name)).sort()).toEqual([
      'one',
      'two'
    ])
  })

  it('counts agents, open reviews once each, waitings by HQ slug, and live workspaces', () => {
    const [section] = buildHqProjectBoard(
      input({
        repos: [repo('shop', null)],
        worktreesByRepo: {
          shop: [
            worktree('shop', 'feature', { lastActivityAt: 500 }),
            worktree('shop', 'main', { isMainWorktree: true, lastActivityAt: 100 }),
            worktree('shop', 'old', { isArchived: true, lastActivityAt: 900 })
          ]
        },
        snapshot: {
          cards: [
            card('shop', 'working', 'a'),
            card('shop', 'working', 'b'),
            card('shop', 'attention', 'c'),
            card('shop', 'done', 'd'),
            card('other', 'attention', 'e')
          ],
          workspaces: [
            workspace('shop', { number: 7, state: 'open' }),
            workspace('shop', { number: 7, state: 'open' }),
            workspace('shop', { number: 8, state: 'draft' }),
            workspace('shop', { number: 9, state: 'merged' }),
            workspace('shop', undefined)
          ]
        },
        waitings: [waiting('w1', 'shop-slug'), waiting('w2', 'other'), waiting('w3', null)],
        pages: [
          {
            repoId: 'shop',
            slug: 'shop-slug',
            title: 'shop — the storefront',
            status: 'active',
            group: null,
            relations: []
          }
        ]
      })
    )
    expect(section.projects[0]).toEqual({
      repoId: 'shop',
      name: 'shop',
      summary: 'the storefront',
      status: 'active',
      worktreeCount: 2,
      lastActivityAt: 500,
      agentsWorking: 2,
      agentsNeedYou: 1,
      openReviews: 2,
      openWaitings: 1,
      openWorktreeId: 'shop::/main'
    })
  })

  it('opens the most recent workspace when there is no primary checkout, and nothing when none', () => {
    const sections = buildHqProjectBoard(
      input({
        repos: [repo('a', null), repo('b', null)],
        worktreesByRepo: {
          a: [worktree('a', 'x', { lastActivityAt: 1 }), worktree('a', 'y', { lastActivityAt: 2 })]
        },
        waitings: [waiting('w1', 'a')],
        pages: [
          {
            repoId: 'b',
            slug: 'b',
            title: 'b — <what it is>',
            status: null,
            group: null,
            relations: []
          }
        ]
      })
    )
    const [a, b] = sections[0].projects
    expect(a.openWorktreeId).toBe('a::/y')
    // Why: without an HQ page the project has no slug, so no waiting can name it.
    expect(a.openWaitings).toBe(0)
    expect(a.summary).toBeNull()
    expect(b.summary).toBeNull()
    expect(b.openWorktreeId).toBeNull()
    expect(b.lastActivityAt).toBeNull()
  })
})
