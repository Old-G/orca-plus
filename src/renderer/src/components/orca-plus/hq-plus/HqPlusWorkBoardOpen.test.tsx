// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react'
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

const chat = (key: string): HqChatItem =>
  ({
    key,
    kind: 'chat',
    group: 'quiet',
    projectName: 'acme',
    repoId: 'r1',
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
      rows: ['a', 'b'].map((key) => ({ item: chat(key), depth: 0, children: 0 })),
      counts: { chats: 2, projects: 1, working: 0, needsYou: 0 }
    }
  ]
} as unknown as HqPlusWorkModel

function actions(picked: string | null): HqPlusWorkActions {
  return {
    now: 0,
    picked,
    onOpen: vi.fn(),
    onOpenClosed: vi.fn(),
    slugOf: () => 'acme',
    colorOf: () => null,
    tileOf: () => ({ letters: 'AC', color: '#3b82f6' }),
    colorOfProject: () => null,
    nameOf: () => null,
    waitOf: () => null
  }
}

afterEach(cleanup)

describe('board marks the chat open on the right (T5d)', () => {
  it('only the open chat row is current, and the mark moves when another chat opens', () => {
    const { rerender } = render(<HqPlusWork model={model} actions={actions('a')} board />)
    const current = (): string[] =>
      screen.getAllByRole('button', { current: true }).map((b) => b.textContent ?? '')
    expect(current()).toHaveLength(1)
    expect(current()[0]).toContain('a')
    rerender(<HqPlusWork model={model} actions={actions('b')} board />)
    expect(current()).toHaveLength(1)
    expect(current()[0]).toContain('b')
  })

  it('the board stylesheet draws a border on the current row', () => {
    const css = readFileSync(join(__dirname, 'hq-plus-board.css'), 'utf8')
    expect(css).toMatch(/\.hqw-board \.hqw-tr\[aria-current='true'\]\s*\{[^}]*outline: 2px solid/)
  })
})
