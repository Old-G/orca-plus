import { describe, expect, it } from 'vitest'
import {
  buildHqChatHistory,
  groupHqChatHistoryByDay,
  HQ_HISTORY_WINDOW_MS,
  hqHistoryDaysAgo,
  readHqHistorySource
} from './hq-chat-history'
import { agentFinishedBellItem, PULSE_BELL_KIND } from './pulse-bell'
import type { PulseInboxItem } from './pulse-types'

const NOW = new Date(2026, 9, 16, 15, 0).getTime()
const HOUR = 60 * 60 * 1000
const LEAF = '38458a6d-4d7f-4f58-a5b8-3f2758c1baab'
const pane = (tabId: string): string => `${tabId}:${LEAF}`

function finished(
  overrides: Partial<PulseInboxItem> & { paneKey: string; worktreeId?: string },
  agent: Partial<Parameters<typeof agentFinishedBellItem>[0]> = {}
): PulseInboxItem {
  const input = agentFinishedBellItem({
    paneKey: overrides.paneKey,
    worktreeId: overrides.worktreeId ?? 'wt-1',
    agentLabel: 'Claude',
    place: 'orca / custom',
    sessionTitle: 'Fix the bell',
    lastMessage: 'All tests pass.',
    ...agent
  })
  return {
    id: overrides.id ?? overrides.paneKey,
    kind: input.kind,
    title: input.title,
    body: overrides.body ?? input.body ?? null,
    urgency: 'normal',
    refKind: input.refKind ?? null,
    refId: overrides.refId ?? input.refId ?? null,
    actions: [],
    dedupeKey: null,
    createdAt: overrides.createdAt ?? NOW,
    readAt: null,
    doneAt: null,
    doneAction: null
  }
}

describe('buildHqChatHistory', () => {
  it('keeps one row per chat with its latest finish and how many there were', () => {
    const native = pane('structured-agent-session-claude_1')
    const history = buildHqChatHistory(
      [
        finished({ id: 'a', paneKey: native, createdAt: NOW - 3 * HOUR }),
        finished({ id: 'b', paneKey: native, createdAt: NOW - HOUR }, { lastMessage: 'Shipped.' }),
        finished({ id: 'c', paneKey: pane('tab-2'), createdAt: NOW - 2 * HOUR })
      ],
      NOW
    )
    expect(history.map((entry) => [entry.tabId, entry.finishes, entry.lastMessage])).toEqual([
      ['structured-agent-session-claude_1', 2, 'Shipped.'],
      ['tab-2', 1, 'All tests pass.']
    ])
    expect(history[0]).toMatchObject({
      sessionId: 'claude_1',
      agent: 'Claude',
      place: 'orca / custom',
      title: 'Fix the bell'
    })
    expect(history[1].sessionId).toBeNull()
  })

  it('reads an item written before the fields were stored apart from its body', () => {
    const [entry] = buildHqChatHistory(
      [
        finished({
          paneKey: pane('tab-1'),
          refId: JSON.stringify({ paneKey: pane('tab-1'), tabId: 'tab-1', worktreeId: 'wt-1' }),
          body: 'Codex · orca / custom · Bell — chat · Done — 3 files'
        })
      ],
      NOW
    )
    expect(entry).toMatchObject({
      agent: 'Codex',
      place: 'orca / custom',
      title: 'Bell',
      lastMessage: 'chat · Done — 3 files'
    })
  })

  it('leaves out other kinds and finishes older than a week', () => {
    const old = finished({ paneKey: pane('tab-1'), createdAt: NOW - HQ_HISTORY_WINDOW_MS - 1 })
    const other = { ...finished({ paneKey: pane('tab-2') }), kind: PULSE_BELL_KIND.agentWaiting }
    expect(buildHqChatHistory([old, other], NOW)).toEqual([])
  })
})

describe('groupHqChatHistoryByDay', () => {
  it('splits rows by local calendar day, newest first', () => {
    const history = buildHqChatHistory(
      [
        finished({ paneKey: pane('a'), createdAt: NOW - HOUR }),
        finished({ paneKey: pane('b'), createdAt: NOW - 20 * HOUR }),
        finished({ paneKey: pane('c'), createdAt: NOW - 22 * HOUR })
      ],
      NOW
    )
    const days = groupHqChatHistoryByDay(history)
    expect(days.map((day) => [hqHistoryDaysAgo(day.dayStart, NOW), day.entries.length])).toEqual([
      [0, 1],
      [1, 2]
    ])
  })
})

describe('readHqHistorySource', () => {
  it('keeps the fields History reads and drops entries shaped otherwise', () => {
    expect(
      readHqHistorySource([
        { kind: 'agent-finished', body: null, refId: '{}', createdAt: 1, extra: true },
        { kind: 'agent-finished', body: 'x' }
      ])
    ).toEqual([{ kind: 'agent-finished', body: null, refId: '{}', createdAt: 1 }])
    expect(readHqHistorySource({ not: 'a list' })).toEqual([])
  })
})
