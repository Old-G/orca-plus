import { describe, expect, it } from 'vitest'
import type { HqChatWireItem } from '../../../src/shared/hq-chat-wire'
import type { HqPlusCard } from '../../../src/shared/hq-plus-log'
import type { HqSpace } from '../../../src/shared/hq-spaces'
import {
  hqPlusPhoneBreakName,
  hqPlusPhoneChatTabId,
  hqPlusPhoneDays,
  hqPlusPhoneMapRooms,
  hqPlusPhoneProjectCards,
  hqPlusPhoneProjectChats,
  type HqpMapWait
} from './hq-plus-phone-map'

const SPACES: HqSpace[] = [
  { slug: 'acme', name: 'Acme', color: '#3b82f6', repoIds: ['r1'], projects: ['acme-app'] },
  {
    slug: 'home',
    name: 'Home',
    color: '#22c55e',
    repoIds: [],
    projects: ['notes'],
    isDefault: true
  }
]

function card(over: Partial<HqPlusCard> & { id: string }): HqPlusCard {
  return {
    kind: 'card',
    at: 1,
    room: 'acme',
    project: 'acme-app',
    address: null,
    sessionId: null,
    type: 'move',
    title: 'Which plan first?',
    body: null,
    report: null,
    open: true,
    done: null,
    entry: null,
    inbox: null,
    ...over
  }
}

function chat(over: Partial<HqChatWireItem> & { key: string }): HqChatWireItem {
  return {
    group: 'working',
    worktreeId: 'wt1',
    paneKey: 'pane-1',
    executionHostId: null,
    projectName: 'acme-app',
    worktreeName: 'main',
    title: 'Release notes',
    preview: '',
    agentType: 'claude',
    unseen: false,
    sortAt: 1,
    color: null,
    repoId: 'r1',
    ...over
  }
}

function wait(over: Partial<HqpMapWait> & { id: string }): HqpMapWait {
  return {
    direction: 'on-them',
    title: 'Dashboard access',
    personId: 'p1',
    who: 'Bob',
    project: 'acme-app',
    dueAt: null,
    createdAt: 10,
    ...over
  }
}

const REPLY_REF = JSON.stringify({ waitingId: 'w1', replyTs: '1.2', author: 'Bob' })

describe('hqPlusPhoneMapRooms', () => {
  const input = {
    spaces: SPACES,
    items: [
      card({ id: 'm1', sessionId: 's-other' }),
      card({
        id: 'r1',
        type: 'reply',
        inbox: {
          id: 'i1',
          kind: 'hq-waiting-reply',
          title: 'Bob answered',
          body: null,
          urgency: 'normal',
          refKind: null,
          refId: REPLY_REF,
          actions: [],
          dedupeKey: null,
          createdAt: 1,
          readAt: null,
          doneAt: null,
          doneAction: null
        }
      }),
      card({ id: 'h1', room: 'home', project: 'notes' })
    ],
    waits: [
      wait({ id: 'w1' }),
      wait({ id: 'w2', title: 'Logo', createdAt: 5 }),
      wait({ id: 'w3', direction: 'on-me' })
    ],
    chats: [
      chat({ key: 'k1', group: 'needs', sessionId: 's-ask' }),
      chat({ key: 'k2', group: 'active' }),
      chat({ key: 'k3', projectName: 'notes', repoId: undefined, group: 'done' })
    ]
  }

  it('builds one room by the desktop model, the answer on its waiting', () => {
    const [room] = hqPlusPhoneMapRooms({ ...input, room: 'acme' })
    expect(room.slug).toBe('acme')
    const project = room.model.projects[0]
    // Why: the move and the asking chat count once each, Bob's answer once on his leaf.
    expect(project).toMatchObject({ slug: 'acme-app', you: 3, waits: 2, chats: 1, oldestWaitAt: 5 })
    expect(room.chats.map((item) => item.key)).toEqual(['k1'])
  })

  it('lists every room for All, each with its own projects', () => {
    const rooms = hqPlusPhoneMapRooms({ ...input, room: null })
    expect(rooms.map((room) => room.slug)).toEqual(['acme', 'home'])
    expect(rooms[1].model.projects.map((project) => project.slug)).toEqual(['notes'])
    expect(rooms[1].model.projects[0]).toMatchObject({ you: 1, chats: 1 })
  })
})

describe('the project screen', () => {
  it('shows the cards on the owner newest first and the asking chat first', () => {
    const items = [
      card({ id: 'a', at: 1 }),
      card({ id: 'b', at: 2 }),
      card({ id: 'c', project: 'other' }),
      card({ id: 'd', open: false, done: { by: 'status', status: 'closed' } })
    ]
    expect(hqPlusPhoneProjectCards(items, 'acme-app').map((item) => item.id)).toEqual(['b', 'a'])
    const chats = [chat({ key: 'w' }), chat({ key: 'n', group: 'needs' })]
    expect(hqPlusPhoneProjectChats(chats, 'acme-app').map((item) => item.key)).toEqual(['n', 'w'])
  })

  it('names a chat tab, breaks long names and counts days', () => {
    expect(hqPlusPhoneChatTabId(chat({ key: 'k', sessionId: 's1' }))).toBe(
      'structured-agent-session-s1'
    )
    expect(hqPlusPhoneChatTabId(chat({ key: 'k', paneKey: 'tab-9:leaf' }))).toBe('tab-9')
    expect(hqPlusPhoneChatTabId(chat({ key: 'k', paneKey: null }))).toBeNull()
    expect(hqPlusPhoneBreakName('lh_support-ai')).toBe('lh_​support-​ai')
    expect(hqPlusPhoneDays(0, 3 * 86_400_000 + 5)).toBe(3)
  })
})
