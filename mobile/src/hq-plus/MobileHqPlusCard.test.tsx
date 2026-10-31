import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { hqPlusLog, type HqPlusCard } from '../../../src/shared/hq-plus-log'
import type { PulseInboxItem } from '../../../src/shared/pulse-types'
import type { RpcClient } from '../transport/rpc/rpc-client-contract'
import { hqPlusFoldConversations } from '../../../src/shared/hq-plus-conversations'
import { MobileHqPlusCard } from './MobileHqPlusCard'
import { doneHqPlusPhoneConversation, markHqPlusPhoneDone } from './hq-plus-phone-actions'

vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  StyleSheet: { create: <T,>(styles: T) => styles },
  Text: 'Text',
  TextInput: 'TextInput',
  View: 'View',
  Platform: { OS: 'ios' }
}))
vi.mock('./hq-plus-phone-actions', () => ({
  closeHqPlusPhoneWait: vi.fn(),
  doneHqPlusPhoneConversation: vi.fn(() => Promise.resolve({ ok: true })),
  markHqPlusPhoneDone: vi.fn(() => Promise.resolve({ ok: true })),
  replyOnHqPlusPhoneCard: vi.fn(),
  runHqPlusPhoneBellAction: vi.fn()
}))

const NOW = Date.parse('2026-10-24T18:42:00Z')

function reportCard(): HqPlusCard {
  const item: PulseInboxItem = {
    id: 'rp',
    kind: 'hq-report',
    title: 'New report',
    body: 'Day review is ready',
    urgency: 'normal',
    refKind: null,
    refId: 'daily/2026-10-24.md',
    actions: [],
    dedupeKey: null,
    createdAt: NOW,
    readAt: null,
    doneAt: null,
    doneAction: null
  }
  const card = hqPlusLog([], [item], NOW - 1000).find((entry) => entry.kind === 'card')
  if (!card || card.kind !== 'card') {
    throw new Error('no report card')
  }
  return card
}

describe('MobileHqPlusCard — a report', () => {
  let renderer: ReactTestRenderer | null = null
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  it('can be marked read from the phone, as on the Mac, besides opening it', async () => {
    const card = reportCard()
    // Why: the phone actions are mocked; only the client's identity reaches them.
    const client: RpcClient = Object.create(null)
    const onChanged = vi.fn()
    act(() => {
      renderer = create(
        createElement(MobileHqPlusCard, {
          card,
          flash: false,
          ctx: {
            client,
            hqPath: '/Users/me/HQ',
            chatOf: () => null,
            colorOf: () => null,
            openChat: vi.fn(),
            openLink: vi.fn(),
            openReport: vi.fn(),
            onChanged
          }
        })
      )
    })
    const buttons = renderer!.root.findAll(
      (node) => String(node.type) === 'Pressable' && node.props.accessibilityRole === 'button'
    )
    expect(buttons.map((node) => node.props.accessibilityLabel)).toEqual(['Open report', 'Done'])
    await act(async () => buttons[1].props.onPress())
    expect(markHqPlusPhoneDone).toHaveBeenCalledWith(client, card, 'seen')
    expect(onChanged).toHaveBeenCalled()
  })
})

describe('MobileHqPlusCard — an MR no other card stands for (hq-ledger-sources)', () => {
  let renderer: ReactTestRenderer | null = null
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  it('opens the MR in the link sheet and says Done through the Mac', async () => {
    const link = 'https://gitlab.com/acme/app/-/merge_requests/7'
    const [card] = hqPlusFoldConversations([], [], {
      conversations: [
        {
          id: 'c-1',
          key: 'gitlab:acme/app!7',
          project: 'app',
          projectHow: 'rule',
          title: 'Review requested: Speed up the import',
          state: 'you',
          lastAt: NOW,
          sessionId: null,
          messages: [{ direction: 'in', author: 'Ann', text: 'Speed up', link, at: NOW }]
        }
      ],
      waitingPlaces: {}
    })
    if (card?.kind !== 'card') {
      throw new Error('no card')
    }
    const client: RpcClient = Object.create(null)
    const openLink = vi.fn()
    const onChanged = vi.fn()
    act(() => {
      renderer = create(
        createElement(MobileHqPlusCard, {
          card,
          flash: false,
          ctx: {
            client,
            hqPath: '/Users/me/HQ',
            chatOf: () => null,
            colorOf: () => null,
            openChat: vi.fn(),
            openLink,
            openReport: vi.fn(),
            onChanged
          }
        })
      )
    })
    const buttons = renderer!.root.findAll(
      (node) => String(node.type) === 'Pressable' && node.props.accessibilityRole === 'button'
    )
    expect(buttons.map((node) => node.props.accessibilityLabel)).toEqual(['Open ↗', 'Done'])
    act(() => buttons[0].props.onPress())
    expect(openLink).toHaveBeenCalledWith(link)
    await act(async () => buttons[1].props.onPress())
    expect(doneHqPlusPhoneConversation).toHaveBeenCalledWith(client, card)
    expect(onChanged).toHaveBeenCalled()
  })
})
