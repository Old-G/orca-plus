import { describe, expect, it, vi } from 'vitest'
import type { AgentSessionRecord } from '../../shared/agent-session-record'
import { withClaudeSubscriptionLaunchEnv } from '../../shared/claude-subscriptions'
import { CLAUDE_SUBSCRIPTIONS_ENABLED } from '../../shared/claude-subscriptions-switch'
import { limitStoppedChatItems } from '../claude-limit-guard/claude-chat-limit-continue'
import { resolveClaudeSubscriptionLaunchConfigDir } from './claude-subscription-launch'

const BASE_DIR = '/home/u/.claude'
const WORK_DIR = '/home/u/.claude-work'
const settings = {
  claudeSubscriptions: [{ id: 'work', label: 'Work', configDir: WORK_DIR }],
  defaultClaudeSubscriptionId: 'work'
}

function chatRecord(path: string): AgentSessionRecord {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: limitStoppedChatItems reads only provider, accountHome and conversationName.
  return {
    provider: 'claude',
    accountHome: { variable: 'CLAUDE_CONFIG_DIR', path },
    conversationName: 'Docs refresh'
  } as unknown as AgentSessionRecord
}

describe('Claude subscriptions switched off', () => {
  it('ships off', () => {
    expect(CLAUDE_SUBSCRIPTIONS_ENABLED).toBe(false)
  })

  it('launches every new session on the selected account, whatever the default or pick', () => {
    const prepareHome = vi.fn()
    expect(
      resolveClaudeSubscriptionLaunchConfigDir({ settings, env: {}, runtime: 'host', prepareHome })
    ).toBeNull()
    expect(
      resolveClaudeSubscriptionLaunchConfigDir({
        settings,
        env: {},
        runtime: 'host',
        subscriptionId: 'work',
        prepareHome
      })
    ).toBeNull()
    expect(prepareHome).not.toHaveBeenCalled()
    expect(withClaudeSubscriptionLaunchEnv('claude', { A: '1' }, settings, 'work')).toEqual({
      A: '1'
    })
  })

  it('offers a chat still pinned to a subscription only the move to the selected account', () => {
    const chats = {
      settings: () => settings,
      baseConfigDir: () => BASE_DIR,
      getRecord: (id: string) =>
        ({ work: chatRecord(WORK_DIR), base: chatRecord(BASE_DIR) })[id] ?? null
    }
    const stop = (key: string) => ({
      kind: 'native-chat' as const,
      key,
      worktreeId: 'wt-1',
      accountId: null,
      stoppedAt: 7,
      resetsAt: null
    })
    const items = limitStoppedChatItems(chats, [stop('work'), stop('base')])
    expect(items.map((item) => (item.actions ?? []).map((action) => action.id))).toEqual([
      ['continue-on:base', 'dismiss']
    ])
  })
})
