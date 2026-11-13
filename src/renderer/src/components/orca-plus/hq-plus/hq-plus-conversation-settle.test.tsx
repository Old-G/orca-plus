// @vitest-environment happy-dom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PulseInboxItem } from '../../../../../shared/pulse-types'
import type { HqFeedResult } from '../../../../../shared/hq-plus-screen'
import type { HqFeedLedger } from '../../../../../shared/hq-feed-ledger'
import type { HqPlusCard } from '../../../../../shared/hq-plus-log'
import { hqPlusFeedLog } from '../../../../../shared/hq-plus-conversations'
import { hqPlusLook } from '../../../../../shared/hq-plus-kinds'
import type { HqPlusLogContext } from './HqPlusLog'

const bellAction = vi.hoisted(() => vi.fn(async (_item: unknown, _action: string) => true))
vi.mock('../pulse-bell/pulse-bell-actions', () => ({ runPulseBellAction: bellAction }))
const toastError = vi.hoisted(() => vi.fn())
vi.mock('sonner', () => ({ toast: { error: toastError } }))

import { HqPlusConversationCard } from './HqPlusConversationCard'

const NOW = Date.UTC(2026, 10, 14, 12)
const MIN = 60_000
const THREAD = 'slack:C0HUB:1793000000.000100'

function intake(n: number): PulseInboxItem {
  return {
    id: `intake-${n}`,
    kind: 'hq-intake',
    title: `Ann: page ${n} not found`,
    body: null,
    urgency: 'normal',
    refKind: 'hq-intake',
    refId: JSON.stringify({
      channel: 'C0HUB',
      ts: '1793000000.000100',
      threadTs: '1793000000.000100',
      author: 'Ann',
      venue: 'channel',
      text: `Ann: page ${n} not found`,
      conversationId: 'c-1',
      at: NOW - (10 - n) * MIN
    }),
    actions: [{ id: 'dismiss', label: `Dismiss ${n}` }],
    dedupeKey: null,
    createdAt: NOW - (10 - n) * MIN,
    readAt: null,
    doneAt: null,
    doneAction: null
  }
}

const ledger: HqFeedLedger = {
  conversations: [
    {
      id: 'c-1',
      key: THREAD,
      project: 'hub',
      projectHow: 'owner',
      title: 'Ann found broken pages',
      state: 'you',
      lastAt: NOW - 8 * MIN,
      sessionId: null,
      messages: [
        { direction: 'in', author: 'Ann', text: 'pages not found', link: null, at: NOW - 8 * MIN }
      ]
    }
  ],
  waitingPlaces: {}
}

function conversation(): HqPlusCard {
  const feed: HqFeedResult = {
    entries: [],
    sessions: [],
    inbox: [intake(1), intake(2)],
    now: NOW,
    ledger
  }
  const card = hqPlusFeedLog(feed, NOW - 12 * 60 * MIN).find(
    (item): item is HqPlusCard => item.kind === 'card' && item.id === `conv:${THREAD}`
  )
  if (!card) {
    throw new Error('no conversation card')
  }
  return card
}

function ctx(onSettling: HqPlusLogContext['onSettling']): HqPlusLogContext {
  return {
    hqPath: null,
    hqWorktreeId: null,
    isExpanded: () => false,
    setExpanded: () => {},
    chatOf: () => null,
    openChat: () => null,
    openLink: () => {},
    onOpenReport: () => {},
    onNotNow: () => {},
    onChanged: () => {},
    onSettling,
    toWork: () => {}
  } as unknown as HqPlusLogContext
}

afterEach(() => {
  cleanup()
  bellAction.mockReset()
  toastError.mockReset()
})

describe('a card folded into a conversation closes on the click (hq-plus-instant, Codex 14.11)', () => {
  it('settles the part by its own id at once, before the bell answers', async () => {
    let answer: (ok: boolean) => void = () => {}
    bellAction.mockImplementation(() => new Promise<boolean>((resolve) => (answer = resolve)))
    const onSettling = vi.fn()
    const card = conversation()
    render(
      <HqPlusConversationCard
        card={card}
        look={hqPlusLook(card)}
        flash={false}
        openChat={null}
        ctx={ctx(onSettling)}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss 1' }))
    expect(onSettling).toHaveBeenCalledWith(
      'inbox:intake-1',
      expect.objectContaining({ by: 'action', action: 'dismiss' })
    )
    expect(bellAction).toHaveBeenCalledWith(expect.objectContaining({ id: 'intake-1' }), 'dismiss')
    await act(async () => answer(true))
    expect(onSettling).toHaveBeenCalledTimes(1)
    expect(toastError).not.toHaveBeenCalled()
  })

  it('brings the part back with a toast when the bell could not do it', async () => {
    bellAction.mockResolvedValue(false)
    const onSettling = vi.fn()
    const card = conversation()
    render(
      <HqPlusConversationCard
        card={card}
        look={hqPlusLook(card)}
        flash={false}
        openChat={null}
        ctx={ctx(onSettling)}
      />
    )
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Dismiss 2' }))
    })
    expect(onSettling).toHaveBeenNthCalledWith(1, 'inbox:intake-2', expect.anything())
    expect(onSettling).toHaveBeenNthCalledWith(2, 'inbox:intake-2', null)
    expect(toastError).toHaveBeenCalledWith(expect.stringMatching(/did not go through/))
  })
})
