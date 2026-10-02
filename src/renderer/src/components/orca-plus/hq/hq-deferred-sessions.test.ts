import { describe, expect, it } from 'vitest'
import type { DashboardCard } from '../../../../../shared/dashboard-snapshot'
import {
  buildHqDeferredSessions,
  pruneHqDeferredDismissed,
  type HqDeferredInput
} from './hq-deferred-sessions'

const MIN = 60_000
const NOW = 1_000 * MIN

function card(paneKey: string, extra: Partial<DashboardCard> = {}): DashboardCard {
  return {
    paneKey,
    ptyId: null,
    agentType: 'claude',
    bucket: 'done',
    dotState: 'done',
    task: paneKey,
    repoId: 'r',
    worktreeId: `w-${paneKey}`,
    tabId: 't',
    leafId: null,
    repoName: 'r',
    worktreeName: 'w',
    startedAt: 0,
    finishedAt: NOW - 45 * MIN,
    stateChangedAt: NOW - 45 * MIN,
    unseen: false,
    lastAgentMessage: 'Готово, всё запушено.',
    ...extra
  }
}

function input(extra: Partial<HqDeferredInput>): HqDeferredInput {
  return {
    cards: [],
    now: NOW,
    thresholdMinutes: 30,
    gitStates: {},
    interruptedPaneKeys: new Set(),
    limitStops: [],
    handoffs: [],
    dismissed: {},
    ...extra
  }
}

describe('HQ deferred sessions', () => {
  it('lists a quiet session with changes left or a question at the end, not a finished report', () => {
    const sessions = buildHqDeferredSessions(
      input({
        cards: [
          card('dirty'),
          card('asks', { lastAgentMessage: 'Схема готова. Мержим?' }),
          card('clean'),
          card('fresh', { finishedAt: NOW - 5 * MIN }),
          card('busy', { bucket: 'working', lastAgentMessage: 'Пушить?' })
        ],
        gitStates: { 'w-dirty': { changes: 3, ahead: 1 }, 'w-clean': { changes: 0, ahead: 0 } }
      })
    )
    expect(sessions.map((s) => [s.card.paneKey, s.reasons.map((r) => r.kind)])).toEqual([
      ['dirty', ['changes', 'ahead']],
      ['asks', ['asks']]
    ])
  })

  it('pins workspace leftovers on the last session there, and skips week-old ones', () => {
    const sessions = buildHqDeferredSessions(
      input({
        cards: [
          card('older', { worktreeId: 'shared', finishedAt: NOW - 3 * 60 * MIN }),
          card('latest', { worktreeId: 'shared', finishedAt: NOW - 60 * MIN }),
          card('ancient', {
            lastAgentMessage: 'Пушить?',
            finishedAt: NOW - 8 * 24 * 60 * MIN
          })
        ],
        gitStates: { shared: { changes: 1, ahead: 0 } }
      })
    )
    expect(sessions.map((s) => s.card.paneKey)).toEqual(['latest'])
  })

  it('counts interrupts, limit stops by pane or workspace, and a waiting handoff', () => {
    const sessions = buildHqDeferredSessions(
      input({
        cards: [card('cut'), card('limited'), card('chat'), card('handed')],
        interruptedPaneKeys: new Set(['cut']),
        limitStops: [
          { paneKey: 'limited', worktreeId: 'elsewhere' },
          { paneKey: null, worktreeId: 'w-chat' }
        ],
        handoffs: [{ id: 'h1', worktreeId: 'w-handed' }]
      })
    )
    expect(sessions.map((s) => [s.card.paneKey, s.reasons[0].kind, s.handoffId])).toEqual([
      ['cut', 'interrupted', null],
      ['limited', 'limit', null],
      ['chat', 'limit', null],
      ['handed', 'handoff', 'h1']
    ])
  })

  it('hides a closed quiet spell but lists the next one, longest quiet first', () => {
    const asks = { lastAgentMessage: 'Жду ответа.' }
    const closedAt = NOW - 45 * MIN
    const sessions = buildHqDeferredSessions(
      input({
        cards: [
          card('closed', asks),
          card('again', { ...asks, finishedAt: NOW - 40 * MIN }),
          card('older', { ...asks, finishedAt: NOW - 90 * MIN })
        ],
        dismissed: { closed: closedAt, again: closedAt }
      })
    )
    expect(sessions.map((s) => s.card.paneKey)).toEqual(['older', 'again'])
  })

  it('forgets closed spells of agents no longer listed', () => {
    expect(pruneHqDeferredDismissed({ a: 1, gone: 2 }, [card('a')])).toEqual({ a: 1 })
  })
})
