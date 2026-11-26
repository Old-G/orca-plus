// @vitest-environment happy-dom

import { cleanup, render } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HqChatItem } from '../hq/hq-chat-list'

vi.mock('../hq/HqChatAvatar', () => ({ useHqChatTitle: (item: HqChatItem) => item.key }))
vi.mock('./use-hq-plus-chat-chip', () => ({
  useHqPlusChatChip: () => ({ chip: null, waitingFor: null, live: false, reply: null })
}))

import { HqPlusWork, type HqPlusWorkActions } from './HqPlusWork'
import type { HqPlusWorkModel } from './hq-plus-work-view'

const chat = (key: string, repoId: string): HqChatItem =>
  ({
    key,
    kind: 'chat',
    group: 'quiet',
    projectName: 'ignored',
    repoId,
    sortAt: 0,
    placedAt: 0,
    card: null
  }) as unknown as HqChatItem

const model: HqPlusWorkModel = {
  needsYou: [],
  closedActiveToday: [],
  runs: [
    {
      key: 'run',
      lead: null,
      leadSession: 'lead',
      rows: [
        { item: chat('fix login', 'r1'), depth: 0, children: 0 },
        { item: chat('spec flow', 'r2'), depth: 1, children: 0 }
      ],
      counts: { chats: 2, projects: 2, working: 0, needsYou: 0 }
    }
  ]
} as unknown as HqPlusWorkModel

const slugs: Record<string, string> = { r1: 'acme-app', r2: 'acme-spec-flow' }

const actions: HqPlusWorkActions = {
  now: 0,
  picked: null,
  onOpen: vi.fn(),
  onOpenClosed: vi.fn(),
  slugOf: (item) => slugs[item.repoId],
  colorOf: () => null,
  tileOf: (item) => ({ letters: item.repoId === 'r1' ? 'AA' : 'SF', color: null }),
  colorOfProject: () => null,
  nameOf: () => null,
  waitOf: () => null
}

afterEach(cleanup)

describe('board rows name their project (T5g)', () => {
  it('each chat row shows the project name under the chat name, not only the tile letters', () => {
    const { container } = render(<HqPlusWork model={model} actions={actions} board />)
    const rows = [...container.querySelectorAll('button.hqw-tr')]
    expect(rows).toHaveLength(2)
    const names = rows.map((row) => row.querySelector('.hqw-nm .hqw-proj')?.textContent)
    expect(names).toEqual(['acme-app', 'acme-spec-flow'])
  })

  it('the Work view (not board) keeps its own project column and has no name-cell label', () => {
    const { container } = render(<HqPlusWork model={model} actions={actions} />)
    expect(container.querySelector('.hqw-proj')).toBeNull()
  })

  it('the label stays inside the name cell: the board grid columns are unchanged', () => {
    const css = readFileSync(join(__dirname, 'hq-plus-board.css'), 'utf8')
    expect(css).toContain(
      'grid-template-columns: minmax(0, 2fr) minmax(0, 72px) minmax(0, 1.6fr) minmax(0, 46px) 34px;'
    )
    expect(css).toMatch(/\.hqw-board \.hqw-proj\s*\{[^}]*text-overflow: ellipsis/)
  })
})
