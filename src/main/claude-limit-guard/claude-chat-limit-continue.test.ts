import { describe, expect, it, vi } from 'vitest'
import type { AgentSessionRecord } from '../../shared/agent-session-record'
import type { ClaudeLimitStoppedAgent } from '../../shared/claude-limit-guard'
import type { StructuredAgentSessionAccountHomeSwitchResult } from '../native-chat/agent-session-wire/structured-agent-session-account-home-switch'
import {
  claudeChatSubscriptionIdOf,
  continueChatOnSubscription,
  limitStoppedChatItems,
  type ClaudeChatLimitContinueDeps
} from './claude-chat-limit-continue'

// Why: these cover the feature itself, which ships switched off (see the switch module).
vi.mock('../../shared/claude-subscriptions-switch', () => ({ CLAUDE_SUBSCRIPTIONS_ENABLED: true }))

const BASE_DIR = '/home/u/.claude'
const WORK_DIR = '/home/u/.claude-work'

function chatRecord(path: string, overrides: Partial<AgentSessionRecord> = {}): AgentSessionRecord {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: these tests read only provider, accountHome, conversationName and providerHandleChain.
  return {
    provider: 'claude',
    accountHome: { variable: 'CLAUDE_CONFIG_DIR', path },
    conversationName: 'Docs refresh',
    providerHandleChain: [
      { handle: { provider: 'claude', sessionId: 'claude-uuid', leafUuid: 'leaf-1' } }
    ],
    ...overrides
  } as unknown as AgentSessionRecord
}

function deps(records: Record<string, AgentSessionRecord>): ClaudeChatLimitContinueDeps {
  return {
    settings: () => ({
      claudeSubscriptions: [{ id: 'work', label: 'Work', configDir: WORK_DIR }]
    }),
    baseConfigDir: () => BASE_DIR,
    getRecord: (sessionId) => records[sessionId] ?? null
  }
}

function stop(
  key: string,
  kind: 'native-chat' | 'terminal' = 'native-chat'
): ClaudeLimitStoppedAgent {
  return { kind, key, worktreeId: 'wt-1', accountId: null, stoppedAt: 7, resetsAt: null }
}

describe('limit-stopped chats in the bell', () => {
  it('offers every other subscription for a chat, and nothing for terminals', () => {
    const chats = deps({ 'chat-base': chatRecord(BASE_DIR), 'chat-work': chatRecord(WORK_DIR) })
    const items = limitStoppedChatItems(chats, [
      stop('chat-base'),
      stop('chat-work'),
      stop('tab:leaf', 'terminal')
    ])
    expect(
      items.map((item) => [item.body, (item.actions ?? []).map((action) => action.id)])
    ).toEqual([
      ['Docs refresh · on Main sign-in', ['continue-on:work', 'dismiss']],
      ['Docs refresh · on Work', ['continue-on:base', 'dismiss']]
    ])
    expect(items[0]?.urgency).toBe('urgent')
  })

  it('names the subscription a chat runs on, null for a dir that is none of them', () => {
    const chats = deps({ a: chatRecord(WORK_DIR), b: chatRecord('/elsewhere') })
    expect(claudeChatSubscriptionIdOf(chats, 'a')).toBe('work')
    expect(claudeChatSubscriptionIdOf(chats, 'b')).toBeNull()
    expect(limitStoppedChatItems(chats, [stop('b')])).toEqual([])
  })
})

describe('continuing a chat on another subscription', () => {
  function continueDeps(record: AgentSessionRecord, hasTranscript = true) {
    const order: string[] = []
    return {
      order,
      deps: {
        ...deps({ chat: record }),
        switchAccountHome: vi.fn(
          async (
            _id: string,
            home: AgentSessionRecord['accountHome']
          ): Promise<StructuredAgentSessionAccountHomeSwitchResult> => {
            order.push(`switch:${home.path}`)
            return { ok: true }
          }
        ),
        prepareHome: vi.fn((dir: string) => order.push(`prepare:${dir}`)),
        hasTranscript: vi.fn(async (input: { claudeProjectsDir: string }) => {
          order.push(`transcript:${input.claudeProjectsDir}`)
          return hasTranscript
        }),
        forgetStop: vi.fn(() => order.push('forget')),
        resume: vi.fn(async () => {
          order.push('resume')
          return true
        })
      }
    }
  }

  it('prepares the dir, checks the conversation is there, moves, then continues', async () => {
    const { deps: continuing, order } = continueDeps(chatRecord(BASE_DIR))
    await expect(continueChatOnSubscription(continuing, 'chat', 'work')).resolves.toEqual({
      ok: true
    })
    expect(order).toEqual([
      `prepare:${WORK_DIR}`,
      `transcript:${WORK_DIR}/projects`,
      `switch:${WORK_DIR}`,
      'forget',
      'resume'
    ])
  })

  it('leaves the chat where it is when the other dir cannot see its conversation', async () => {
    const { deps: continuing } = continueDeps(chatRecord(BASE_DIR), false)
    await expect(continueChatOnSubscription(continuing, 'chat', 'work')).resolves.toEqual({
      ok: false,
      reason: 'transcriptMissing'
    })
    expect(continuing.switchAccountHome).not.toHaveBeenCalled()
    expect(continuing.resume).not.toHaveBeenCalled()
  })

  it('needs no preparation to go back to the main sign-in, and refuses an unknown id', async () => {
    const { deps: continuing } = continueDeps(chatRecord(WORK_DIR))
    await continueChatOnSubscription(continuing, 'chat', 'base')
    expect(continuing.prepareHome).not.toHaveBeenCalled()
    expect(continuing.switchAccountHome).toHaveBeenCalledWith('chat', {
      variable: 'CLAUDE_CONFIG_DIR',
      path: BASE_DIR
    })
    await expect(continueChatOnSubscription(continuing, 'chat', 'gone')).resolves.toEqual({
      ok: false,
      reason: 'unknownSubscription'
    })
  })

  it('keeps the stop when the host refuses the move', async () => {
    const { deps: continuing } = continueDeps(chatRecord(BASE_DIR))
    continuing.switchAccountHome.mockResolvedValueOnce({ ok: false, reason: 'busy' })
    await expect(continueChatOnSubscription(continuing, 'chat', 'work')).resolves.toEqual({
      ok: false,
      reason: 'busy'
    })
    expect(continuing.forgetStop).not.toHaveBeenCalled()
  })
})
