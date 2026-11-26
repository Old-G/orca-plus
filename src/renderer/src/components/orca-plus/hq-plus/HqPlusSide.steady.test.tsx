// @vitest-environment happy-dom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HqChatLinksResult } from '../../../../../shared/hq-chat-links'
import { structuredAgentSessionTabId } from '../../../../../shared/agent-session/view/structured-agent-session-projection'
import type { Tab } from '../../../../../shared/workspace-layout/tab-groups/tab-types'
import type { HqChatItem } from '../hq/hq-chat-list'
import type { HqPlusChatCloser } from './HqPlusCloseChat'

vi.mock('./HqPlusChatsBy', () => ({
  useHqPlusChatsBy: () => ['work', () => {}],
  HqPlusChatsBySwitch: () => null
}))
vi.mock('./HqPlusNewChat', () => ({
  HqPlusNewChat: () => null,
  useHqPlusNewChatTargets: () => []
}))
vi.mock('./HqPlusSideProjects', () => ({
  AllProjects: () => null,
  ProjectHeader: () => null
}))
vi.mock('./HqPlusSideBlock', () => ({
  HqPlusSideBlock: ({ children }: { children: React.ReactNode }) => <div>{children}</div>
}))
vi.mock('./HqPlusChatRow', () => ({
  HqPlusChatRow: ({ item, closer }: { item: HqChatItem; closer: HqPlusChatCloser | null }) => (
    <div data-chat={item.key}>
      <button type="button" aria-label={`close ${item.key}`} onClick={() => closer?.close()} />
    </div>
  )
}))

import { HqPlusSide } from './HqPlusSide'

const chat = (sessionId: string, at: number): HqChatItem => {
  const tab: Tab = {
    id: structuredAgentSessionTabId(sessionId),
    entityId: sessionId,
    groupId: 'group-1',
    worktreeId: 'wt-acme',
    contentType: 'agent-session',
    agentSessionAgent: 'claude',
    label: sessionId,
    customLabel: null,
    color: null,
    sortOrder: 0,
    createdAt: at
  }
  return {
    kind: 'chat',
    tab,
    key: sessionId,
    group: 'done',
    displayState: 'idle',
    agentType: 'claude',
    card: null,
    repoId: 'repo-acme',
    worktreeId: 'wt-acme',
    projectName: 'acme',
    worktreeName: 'main',
    hostKind: 'local',
    sortAt: at,
    placedAt: at
  } as HqChatItem
}

const links = {
  links: [{ sessionId: 'w1', parentSessionId: 'lead', at: 1, via: 'launch' }],
  continues: []
} as unknown as HqChatLinksResult

const lead = chat('lead', 1)
const w1 = chat('w1', 3)
const other = chat('other', 4)

function column(items: HqChatItem[], close: (key: string) => void): React.JSX.Element {
  return (
    <HqPlusSide
      ticker={null}
      waitsOnThem={[]}
      chats={{
        marked: [],
        projects: [
          {
            repoId: 'repo-acme',
            projectName: 'acme',
            kept: false,
            items: [...items].sort((a, b) => b.placedAt - a.placedAt)
          }
        ],
        quiet: []
      }}
      drafts={[]}
      colorFor={() => 'blue'}
      tileOfRepo={() => ({ letters: 'AC', color: null })}
      onKeepProject={() => {}}
      onMarkDoneRead={() => {}}
      stats={null}
      picked={null}
      tileOf={() => ({ letters: 'AC', color: null })}
      closerOf={(item) => ({ working: false, close: () => close(item.key) })}
      queue={{ now: 0 } as never}
      onPickChat={() => {}}
      openChats={items}
      chatLinks={links}
      slugOf={() => 'acme'}
    />
  )
}

const order = (container: HTMLElement): string[] =>
  [...container.querySelectorAll('[data-chat]')].map((node) => node.getAttribute('data-chat') ?? '')

afterEach(cleanup)

describe('HqPlusSide after a ✕ (owner 26.11)', () => {
  it('keeps the other chats where they were until the pointer leaves the column', () => {
    const close = vi.fn()
    const { container, rerender } = render(column([lead, w1, other], close))
    // The lead heads its tree, the lone chat is below.
    expect(order(container)).toEqual(['lead', 'w1', 'other'])

    fireEvent.click(screen.getByLabelText('close w1'))
    expect(close).toHaveBeenCalledWith('w1')
    // The tab is gone; on its own the lead would fall out of the tree, below the newer lone chat.
    rerender(column([lead, other], close))
    expect(order(container)).toEqual(['lead', 'other'])

    act(() => {
      fireEvent.pointerLeave(container.querySelector('aside') as HTMLElement)
    })
    expect(order(container)).toEqual(['other', 'lead'])
  })

  it('ends the hold when a new chat opens', () => {
    const close = vi.fn()
    const { container, rerender } = render(column([lead, w1, other], close))
    fireEvent.click(screen.getByLabelText('close w1'))
    rerender(column([lead, other], close))
    rerender(column([lead, other, chat('fresh', 9)], close))
    expect(order(container)).toEqual(['fresh', 'other', 'lead'])
  })
})
