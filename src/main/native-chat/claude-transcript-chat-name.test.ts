import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentSessionRecord } from '../../shared/agent-session-record'
import {
  createClaudeTranscriptChatNamer,
  readClaudeTranscriptAiTitle
} from './claude-transcript-chat-name'

let dir: string | null = null

afterEach(() => {
  if (dir) {
    rmSync(dir, { recursive: true, force: true })
    dir = null
  }
})

function transcript(lines: string[]): string {
  dir = mkdtempSync(join(tmpdir(), 'claude-title-'))
  const path = join(dir, 'session.jsonl')
  writeFileSync(path, `${lines.join('\n')}\n`)
  return path
}

function record(overrides: Partial<AgentSessionRecord> = {}, agent = 'claude'): AgentSessionRecord {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the namer reads only these fields.
  return {
    sessionId: 'chat-1',
    location: { workspaceId: 'repo::/wt' },
    providerHandleChain: [{ handle: { agent, nativeId: 'provider-1' } }],
    ...overrides
  } as unknown as AgentSessionRecord
}

function setup(initial: AgentSessionRecord, title: string | null = 'Корзина покупок') {
  let current = initial
  let now = 1_000_000
  const store = {
    getRecord: vi.fn(() => current),
    compareAndSetConversationName: vi.fn(
      async (_id: string, name: string | null, expected: string | null) => {
        if ((current.conversationName ?? null) !== expected) {
          return null
        }
        current = { ...current, conversationName: name ?? undefined }
        return current
      }
    )
  }
  const readTitle = vi.fn(async () => title)
  const onNamed = vi.fn()
  const namer = createClaudeTranscriptChatNamer({
    getStore: () => store,
    readTitle,
    onNamed,
    now: () => now
  })
  return {
    namer,
    store,
    readTitle,
    onNamed,
    current: () => current,
    advance: (ms: number) => {
      now += ms
    }
  }
}

describe('readClaudeTranscriptAiTitle', () => {
  it('takes the last title Claude wrote and ignores other lines', async () => {
    const path = transcript([
      JSON.stringify({ type: 'user', message: { content: 'про "ai-title" в тексте' } }),
      JSON.stringify({ type: 'ai-title', aiTitle: 'Первое' }),
      JSON.stringify({ type: 'assistant' }),
      JSON.stringify({ type: 'ai-title', aiTitle: 'Корзина покупок' }),
      '{"type":"ai-title","aiTi'
    ])
    await expect(readClaudeTranscriptAiTitle(path)).resolves.toBe('Корзина покупок')
  })

  it('is null before Claude titles the chat', async () => {
    const path = transcript([JSON.stringify({ type: 'user' })])
    await expect(readClaudeTranscriptAiTitle(path)).resolves.toBeNull()
  })
})

describe('createClaudeTranscriptChatNamer', () => {
  it('names an unnamed Claude chat after its transcript title and refreshes the surfaces', async () => {
    const { namer, readTitle, onNamed, current } = setup(record())
    namer({ sessionId: 'chat-1' })
    await vi.waitFor(() => expect(onNamed).toHaveBeenCalledWith('repo::/wt', 'chat-1'))
    expect(readTitle).toHaveBeenCalledWith('provider-1')
    expect(current().conversationName).toBe('Корзина покупок')
  })

  it('never replaces a name the chat already has', async () => {
    const { namer, readTitle } = setup(record({ conversationName: 'Мой' }))
    namer({ sessionId: 'chat-1' })
    await Promise.resolve()
    expect(readTitle).not.toHaveBeenCalled()
  })

  it('skips chats of other agents', async () => {
    const { namer, readTitle } = setup(record({}, 'codex'))
    namer({ sessionId: 'chat-1' })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(readTitle).not.toHaveBeenCalled()
  })

  it('retries a chat Claude had not titled yet, but not on every status update', async () => {
    const { namer, readTitle, advance } = setup(record(), null)
    namer({ sessionId: 'chat-1' })
    await vi.waitFor(() => expect(readTitle).toHaveBeenCalledTimes(1))
    await new Promise((resolve) => setTimeout(resolve, 0))
    namer({ sessionId: 'chat-1' })
    expect(readTitle).toHaveBeenCalledTimes(1)
    advance(20_000)
    namer({ sessionId: 'chat-1' })
    await vi.waitFor(() => expect(readTitle).toHaveBeenCalledTimes(2))
  })
})
