import { describe, expect, it } from 'vitest'
import type { HqSession } from '../../shared/hq-journal'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import { hqRouterChats } from './hq-router-chats'

const NOW = 10_000_000_000

function session(sessionId: string, extra: Partial<HqSession> = {}): HqSession {
  return {
    sessionId,
    address: `acme/${sessionId}`,
    agent: 'claude',
    worktreeId: 'repo-acme::/Users/me/acme',
    workspace: 'personal',
    project: 'acme',
    state: 'done',
    contextPct: null,
    openedAt: NOW - 5_000,
    lastActivityAt: NOW - 1_000,
    closedAt: null,
    parentSessionId: null,
    taskRef: null,
    ...extra
  }
}

function runtime(sessions: HqSession[]): OrcaRuntimeService {
  return {
    pulseListJournal: () => [],
    pulseRouter: () => ({ roleOf: () => null, leadOf: () => null }),
    pulseListRecentSessions: () => sessions,
    pulseLiveSessionOf: (id: string) => id,
    openedAgentSessionRecordStore: () => null
  } as unknown as OrcaRuntimeService
}

describe('router chats', () => {
  it('marks a chat without a tab closed, a mid-turn one open, an idle one done', () => {
    const chats = hqRouterChats(
      runtime([
        session('working', { state: 'working' }),
        session('idle'),
        session('no-tab', { state: 'working' }),
        session('gone', { state: 'closed' })
      ]),
      NOW,
      new Set(['working', 'idle'])
    )
    expect(chats.map((chat) => [chat.sessionId, chat.state])).toEqual([
      ['working', 'open'],
      ['idle', 'done'],
      ['no-tab', 'closed']
    ])
  })

  it('closes no chat when the tabs could not be read', () => {
    const chats = hqRouterChats(runtime([session('idle')]), NOW, null)
    expect(chats[0].state).toBe('done')
  })
})
