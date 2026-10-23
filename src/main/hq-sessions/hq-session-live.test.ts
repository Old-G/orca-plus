import { describe, expect, it } from 'vitest'
import type { HqSession } from '../../shared/hq-journal'
import { hqChatSessionOf, hqLiveSessions } from './hq-session-live'

const NOW = new Date(2026, 9, 24, 15, 0).getTime()

function known(sessionId: string, over: Partial<HqSession> = {}): HqSession {
  return {
    sessionId,
    address: `acme-api/${sessionId}`,
    agent: 'claude',
    worktreeId: 'r-api::/w/api',
    workspace: 'acme',
    project: 'acme-api',
    state: 'done',
    contextPct: null,
    openedAt: NOW - 5 * 3_600_000,
    lastActivityAt: NOW - 3_600_000,
    closedAt: null,
    parentSessionId: null,
    taskRef: null,
    ...over
  }
}

describe('HQ+ session dispatcher: what each chat is doing now', () => {
  it('reads chat ids from tab ids and pane keys only', () => {
    expect(hqChatSessionOf('structured-agent-session-claude_ab12:tab-1')).toBe('claude_ab12')
    expect(hqChatSessionOf('structured-agent-session-claude_ab12')).toBe('claude_ab12')
    expect(hqChatSessionOf('terminal-7')).toBeNull()
  })

  it('takes the state from the live agent, the open question and the tab, in that order', () => {
    const live = hqLiveSessions({
      sessions: [known('busy'), known('asks'), known('gone'), known('idle')],
      agents: [{ sessionId: 'busy', state: 'working', updatedAt: NOW - 1_000 }],
      tabs: [
        { sessionId: 'busy', worktreeId: 'r-api::/w/api', lastFocusedAt: null, focused: false },
        {
          sessionId: 'asks',
          worktreeId: 'r-api::/w/api',
          lastFocusedAt: NOW - 600_000,
          focused: false
        },
        { sessionId: 'idle', worktreeId: 'r-api::/w/api', lastFocusedAt: null, focused: true },
        { sessionId: 'fresh', worktreeId: 'r-kite::/w/kite', lastFocusedAt: null, focused: false }
      ],
      asking: new Set(['asks']),
      contextPct: new Map([['idle', 41]]),
      name: () => null,
      placeOfWorktree: () => ({ project: 'kite', workspace: 'hobby' }),
      now: NOW
    })
    const by = new Map(live.map((session) => [session.sessionId, session]))
    expect(by.get('busy')).toMatchObject({
      state: 'working',
      midTurn: true,
      lastActivityAt: NOW - 1_000
    })
    expect(by.get('asks')).toMatchObject({
      state: 'waiting',
      midTurn: false,
      ownerAt: NOW - 600_000
    })
    expect(by.get('gone')).toMatchObject({ state: 'closed', tabOpen: false, ownerAt: null })
    expect(by.get('idle')).toMatchObject({ state: 'done', ownerAt: NOW, contextPct: 41 })
    expect(by.get('fresh')).toMatchObject({ project: 'kite', workspace: 'hobby', address: null })
  })
})
