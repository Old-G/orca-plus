// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HqChatItem } from '../hq/hq-chat-list'

vi.mock('../hq/HqChatAvatar', () => ({
  useHqChatTitle: (item: HqChatItem) => item.key
}))
vi.mock('./use-hq-plus-chat-chip', () => ({
  useHqPlusChatChip: (item: HqChatItem) => ({
    chip: null,
    waitingFor: null,
    live: false,
    reply: `reply of ${item.key}`
  })
}))
vi.mock('./HqPlusNewChatMenu', () => ({
  HqPlusNewChatMenu: ({
    worktreeId,
    children
  }: {
    worktreeId: string
    children: React.ReactElement
  }) => <span data-worktree={worktreeId}>{children}</span>
}))

import { HqPlusWork, type HqPlusWorkActions } from './HqPlusWork'
import type { HqPlusWorkModel } from './hq-plus-work-view'

const chat = (key: string, repoId = 'r1'): HqChatItem =>
  ({
    key,
    kind: 'chat',
    group: 'quiet',
    projectName: 'acme',
    repoId,
    sortAt: 0,
    placedAt: 0,
    card: null
  }) as unknown as HqChatItem

const lead = chat('lead')
const model = {
  needsYou: [],
  closedActiveToday: [],
  runs: [
    {
      key: 'run',
      lead,
      leadSession: 'lead',
      rows: [lead, chat('a'), chat('b', 'r2')].map((item) => ({
        item,
        depth: 0,
        children: 0
      })),
      counts: { chats: 3, projects: 2, working: 0, needsYou: 0 }
    }
  ]
} as unknown as HqPlusWorkModel

afterEach(cleanup)

function actions(close = vi.fn()): HqPlusWorkActions {
  return {
    now: 0,
    picked: null,
    onOpen: vi.fn(),
    onOpenClosed: vi.fn(),
    slugOf: (item) => `proj-${item.repoId}`,
    colorOf: () => null,
    tileOf: () => ({ letters: 'AC', color: null }),
    colorOfProject: () => null,
    nameOf: () => null,
    waitOf: () => null,
    closerOf: () => ({ working: false, close }),
    newChatWorktreeOf: (item) => `wt-${item.repoId}`
  }
}

describe('board row actions (T5e)', () => {
  it('× on a row closes that chat only', () => {
    const close = vi.fn()
    render(<HqPlusWork model={model} actions={actions(close)} board />)
    fireEvent.click(screen.getByRole('button', { name: 'Close chat a' }))
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('«+» of a row starts a chat in that row’s project; the lead’s group has «+ chat» too', () => {
    const { container } = render(<HqPlusWork model={model} actions={actions()} board />)
    const plus = screen.getByRole('button', { name: 'New chat in proj-r2' })
    expect(plus.closest('[data-worktree]')?.getAttribute('data-worktree')).toBe('wt-r2')
    const runNew = container.querySelector('.hqw-run-new')
    expect(runNew?.closest('[data-worktree]')?.getAttribute('data-worktree')).toBe('wt-r1')
  })

  it('a row’s tooltip is the reply of that row’s own chat', () => {
    const { container } = render(<HqPlusWork model={model} actions={actions()} board />)
    const rows = [...container.querySelectorAll('button.hqw-tr')]
    expect(rows.map((row) => row.getAttribute('title'))).toEqual([
      'proj-r1 · reply of lead',
      'proj-r1 · reply of a',
      'proj-r2 · reply of b'
    ])
  })

  it('outside the board a row has no extra buttons', () => {
    const { container } = render(<HqPlusWork model={model} actions={actions()} />)
    expect(container.querySelector('.hqw-acts')).toBeNull()
    expect(container.querySelector('.hqw-run-new')).toBeNull()
  })
})
