import { createElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HqChatWireItem } from '../../../src/shared/hq-chat-wire'
import type { HqJournalEntry } from '../../../src/shared/hq-journal'
import type { HqPlusCard, HqPlusLogItem } from '../../../src/shared/hq-plus-log'
import {
  hqPlusProjectCardOf,
  hqPlusProjectFeed,
  type HqPlusProjectInput
} from '../../../src/shared/hq-plus-project-cards'
import { MobileHqPlusProjectCard } from './MobileHqPlusProjectCard'
import type { HqpProjectContext } from './MobileHqPlusProjectParts'
import { MobileHqPlusProjectFeed } from './MobileHqPlusProjectFeed'

vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  StyleSheet: { create: <T,>(styles: T) => styles },
  Text: 'Text',
  TextInput: 'TextInput',
  View: 'View',
  Platform: { OS: 'ios' }
}))
// Why: the cards a line or a chat opens to have their own tests; here only which one opens matters.
vi.mock('./MobileHqPlusCard', () => ({ MobileHqPlusCard: 'MobileHqPlusCard' }))
vi.mock('./MobileHqPlusLine', () => ({ MobileHqPlusChatLine: 'MobileHqPlusChatLine' }))

const NOW = Date.parse('2026-10-31T15:00:00Z')
const HOUR = 3_600_000
const DAY = 24 * HOUR

function thread(id: string, project: string | null, since: number): HqPlusCard {
  return {
    kind: 'card',
    id,
    at: since,
    room: 'acme',
    project,
    address: null,
    sessionId: null,
    type: 'conversation',
    title: 'Merge the tickets of one customer',
    body: null,
    report: null,
    open: true,
    done: null,
    entry: null,
    inbox: null,
    conversation: {
      key: `gitlab:acme/api!${id}`,
      title: 'Merge the tickets of one customer',
      guessed: false,
      messages: [{ direction: 'in', author: 'Ann', text: 'can you merge?', link: null, at: since }],
      parts: [],
      link: null,
      ledgerState: 'you'
    }
  }
}

function chatLine(sessionId: string): HqPlusLogItem {
  return {
    kind: 'line',
    id: `line-${sessionId}`,
    at: NOW - HOUR,
    room: 'acme',
    project: 'acme-api',
    address: null,
    sessionId,
    tone: 'agent',
    title: 'Done: the table is in main',
    journalKind: 'chat.report'
  }
}

function wire(key: string, group: HqChatWireItem['group']): HqChatWireItem {
  return {
    key,
    title: `Chat ${key}`,
    projectName: 'acme-api',
    group,
    sortAt: NOW - HOUR,
    sessionId: key,
    worktreeId: 'wt-1',
    repoId: 'r1'
  } as HqChatWireItem
}

const sent: HqJournalEntry = {
  id: 'e-1',
  at: NOW - 2 * HOUR,
  workspace: 'acme',
  kind: 'approve.result',
  project: 'acme-api',
  address: null,
  sessionId: 's1',
  personId: null,
  title: 'Approved → DM Ann: Slack · send message',
  body: 'Ann, the table is in main.',
  needs: 'nobody',
  status: 'done',
  replyTo: null,
  refKind: 'decision',
  refId: 'd-1',
  links: [],
  source: 'approve-gate',
  dedupeKey: null
}

const input: HqPlusProjectInput = {
  items: [thread('t1', 'acme-api', NOW - 3 * DAY), chatLine('s1')],
  waits: [
    {
      id: 'w1',
      personName: 'Bob',
      project: 'acme-api',
      title: 'Review the MR',
      at: NOW - 2 * DAY,
      answerId: null
    },
    {
      id: 'w2',
      personName: 'Ann',
      project: 'acme-web',
      title: 'Send the file',
      at: NOW - DAY,
      answerId: null
    }
  ],
  chats: [
    { key: 's1', project: 'acme-api', state: 'working', sessionId: 's1', title: 'Fix', at: NOW },
    { key: 's2', project: 'acme-api', state: 'asks', sessionId: 's2', title: 'Ask', at: NOW }
  ],
  entries: [sent],
  since: NOW - 12 * HOUR
}

function context(over: Partial<HqpProjectContext> = {}): HqpProjectContext {
  const chats = [wire('s1', 'working'), wire('s2', 'needs')]
  return {
    feed: {
      client: null,
      hqPath: '/Users/me/HQ',
      chatOf: (sessionId) => chats.find((chat) => chat.sessionId === sessionId) ?? null,
      colorOf: () => null,
      openChat: vi.fn(),
      openLink: vi.fn(),
      openReport: vi.fn(),
      onChanged: vi.fn()
    },
    now: NOW,
    roomName: () => 'Acme',
    personName: () => null,
    chatOf: (key) => chats.find((chat) => chat.key === key) ?? null,
    closeChat: vi.fn(),
    workspace: () => null,
    ...over
  }
}

function texts(root: ReactTestInstance): string {
  return root
    .findAll((node) => String(node.type) === 'Text')
    .map((node) => node.children.map((child) => (typeof child === 'string' ? child : '')).join(''))
    .join('\n')
}

function press(root: ReactTestInstance, label: string): void {
  const button = root.find(
    (node) => String(node.type) === 'Pressable' && node.props.accessibilityLabel === label
  )
  act(() => button.props.onPress())
}

describe('MobileHqPlusProjectCard', () => {
  let renderer: ReactTestRenderer | null = null
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  it('shows the head, a line per conversation, and opens the line to its card', () => {
    const card = hqPlusProjectCardOf(input, 'acme-api')
    act(() => {
      renderer = create(createElement(MobileHqPlusProjectCard, { card, ctx: context() }))
    })
    const root = renderer!.root
    const shown = texts(root)
    expect(shown).toContain('Your move · 1')
    expect(shown).toContain('We wait · 1')
    expect(shown).toContain('ACME')
    expect(root.findAll((node) => String(node.type) === 'MobileHqPlusCard')).toHaveLength(0)
    press(root, 'Ann: Merge the tickets of one customer')
    const opened = root.findAll((node) => String(node.type) === 'MobileHqPlusCard')
    expect(opened.map((node) => node.props.card.id)).toEqual(['t1'])
    expect(opened[0].props.bare).toBe(true)
  })

  it('folds We wait, Today and Chats to one line each, and opens them', () => {
    const card = hqPlusProjectCardOf(input, 'acme-api')
    act(() => {
      renderer = create(createElement(MobileHqPlusProjectCard, { card, ctx: context() }))
    })
    const root = renderer!.root
    expect(texts(root)).toContain('Bob 1 — oldest 2 d')
    expect(texts(root)).toContain('Approved → DM Ann: Ann, the table is in main.')
    expect(texts(root)).toContain('1 asks you · 1 working')
    press(root, 'Show We wait · 1')
    expect(texts(root)).toContain('Review the MR')
    press(root, 'Show Chats · 2')
    press(root, 'Chat Fix')
    const chat = root.find((node) => String(node.type) === 'MobileHqPlusChatLine')
    expect(chat.props.item.id).toBe('line-s1')
  })

  it('asks before closing a working chat, then closes it on the Mac', () => {
    const ctx = context()
    const card = hqPlusProjectCardOf(input, 'acme-api')
    act(() => {
      renderer = create(createElement(MobileHqPlusProjectCard, { card, ctx }))
    })
    const root = renderer!.root
    press(root, 'Show Chats · 2')
    press(root, 'Close chat Fix')
    expect(ctx.closeChat).not.toHaveBeenCalled()
    expect(texts(root)).toContain('Chat is working — close?')
    const close = root.find(
      (node) =>
        String(node.type) === 'Pressable' &&
        node.findAll((child) => child.children.includes('Close')).length > 0
    )
    act(() => close.props.onPress())
    expect(ctx.closeChat).toHaveBeenCalledWith(expect.objectContaining({ key: 's1' }))
  })

  it('opens the asking chat from Chat in the head', () => {
    const ctx = context()
    const card = hqPlusProjectCardOf(input, 'acme-api')
    act(() => {
      renderer = create(createElement(MobileHqPlusProjectCard, { card, ctx }))
    })
    press(renderer!.root, 'Chat')
    expect(ctx.feed.openChat).toHaveBeenCalledWith(expect.objectContaining({ key: 's2' }))
  })
})

describe('MobileHqPlusProjectFeed', () => {
  let renderer: ReactTestRenderer | null = null
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  it('puts the newest project last, folds a wait-only project to one line, and opens FYI from its row', () => {
    const feed = hqPlusProjectFeed({
      ...input,
      items: [
        ...input.items,
        {
          ...thread('f1', 'acme-docs', NOW - HOUR),
          conversation: {
            ...thread('f1', 'acme-docs', NOW - HOUR).conversation!,
            ledgerState: 'fyi'
          }
        }
      ],
      filter: 'all'
    })
    const onFilter = vi.fn()
    act(() => {
      renderer = create(
        createElement(MobileHqPlusProjectFeed, {
          feed,
          filter: 'all',
          ctx: context(),
          flash: null,
          empty: 'Nothing here yet today.',
          onFilter
        })
      )
    })
    const root = renderer!.root
    const cards = root.findAll(
      (node) =>
        typeof node.props.testID === 'string' && node.props.testID.startsWith('hq-plus-project-')
    )
    expect([...new Set(cards.map((node) => node.props.testID))]).toEqual([
      'hq-plus-project-acme-web',
      'hq-plus-project-acme-api'
    ])
    expect(texts(root)).toContain('Ann 1 — oldest 1 d')
    press(root, 'Show FYI')
    expect(onFilter).toHaveBeenCalledWith('fyi')
  })
})
