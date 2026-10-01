import { describe, expect, it, vi } from 'vitest'
import type { AgentSessionRecord } from '../../shared/agent-session-record'
import {
  moveClaudeChatToRoutedAccount,
  type ClaudeChatAccountFollowDeps
} from './claude-chat-account-follow'

const OLD_DIR = '/data/claude-profiles/personal/home'
const NEW_DIR = '/data/claude-profiles/team/home'

function chatRecord(path: string, provider = 'claude'): AgentSessionRecord {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the move reads only provider, accountHome and providerHandleChain.
  return {
    provider,
    accountHome: { variable: 'CLAUDE_CONFIG_DIR', path },
    providerHandleChain: [
      { handle: { transport: 'claude-sdk', agent: 'claude', nativeId: 'claude-uuid' } }
    ]
  } as unknown as AgentSessionRecord
}

function deps(
  record: AgentSessionRecord | null,
  overrides: Partial<ClaudeChatAccountFollowDeps> = {}
): ClaudeChatAccountFollowDeps {
  return {
    getRecord: () => record,
    routedConfigDir: async () => NEW_DIR,
    switchAccountHome: vi.fn(async () => ({ ok: true }) as const),
    hasTranscript: vi.fn(async () => true),
    ...overrides
  }
}

describe('a nudged chat follows the account launches run in', () => {
  it('moves a chat pinned to the old account folder before the nudge', async () => {
    const d = deps(chatRecord(OLD_DIR))
    await expect(moveClaudeChatToRoutedAccount(d, 'chat')).resolves.toBe('moved')
    expect(d.hasTranscript).toHaveBeenCalledWith({
      providerSessionId: 'claude-uuid',
      claudeProjectsDir: `${NEW_DIR}/projects`
    })
    expect(d.switchAccountHome).toHaveBeenCalledWith('chat', {
      variable: 'CLAUDE_CONFIG_DIR',
      path: NEW_DIR
    })
  })

  it('leaves a chat already on the routed folder alone', async () => {
    const d = deps(chatRecord(NEW_DIR))
    await expect(moveClaudeChatToRoutedAccount(d, 'chat')).resolves.toBe('alreadyThere')
    expect(d.switchAccountHome).not.toHaveBeenCalled()
  })

  it('moves a chat whose live child spawned on the old account though its record names the new one', async () => {
    const d = deps(chatRecord(NEW_DIR), { launchHome: () => OLD_DIR })
    await expect(moveClaudeChatToRoutedAccount(d, 'chat')).resolves.toBe('moved')
    expect(d.switchAccountHome).toHaveBeenCalledWith('chat', {
      variable: 'CLAUDE_CONFIG_DIR',
      path: NEW_DIR
    })
  })

  it('leaves a chat whose live child already runs on the routed folder', async () => {
    const d = deps(chatRecord(OLD_DIR), { launchHome: () => NEW_DIR })
    await expect(moveClaudeChatToRoutedAccount(d, 'chat')).resolves.toBe('alreadyThere')
    expect(d.switchAccountHome).not.toHaveBeenCalled()
  })

  it('keeps the chat where it is when the new folder cannot see its conversation', async () => {
    const d = deps(chatRecord(OLD_DIR), { hasTranscript: vi.fn(async () => false) })
    await expect(moveClaudeChatToRoutedAccount(d, 'chat')).resolves.toBe('transcriptMissing')
    expect(d.switchAccountHome).not.toHaveBeenCalled()
  })

  it('never throws when the route or the switch fails', async () => {
    const noRoute = deps(chatRecord(OLD_DIR), {
      routedConfigDir: async () => {
        throw new Error('setup failed')
      }
    })
    await expect(moveClaudeChatToRoutedAccount(noRoute, 'chat')).resolves.toBe('noRoute')
    const busy = deps(chatRecord(OLD_DIR), {
      switchAccountHome: async () => ({ ok: false, reason: 'busy' })
    })
    await expect(moveClaudeChatToRoutedAccount(busy, 'chat')).resolves.toBe('busy')
    const refused = deps(chatRecord(OLD_DIR), {
      switchAccountHome: async () => {
        throw new Error('lease moved')
      }
    })
    await expect(moveClaudeChatToRoutedAccount(refused, 'chat')).resolves.toBe('leaseHeld')
  })

  it('ignores non-Claude chats', async () => {
    const d = deps(chatRecord(OLD_DIR, 'codex'))
    await expect(moveClaudeChatToRoutedAccount(d, 'chat')).resolves.toBe('notClaude')
  })
})
