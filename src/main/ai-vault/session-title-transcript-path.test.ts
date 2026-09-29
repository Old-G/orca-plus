import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const parseAgentSessionFileCached = vi.hoisted(() => vi.fn())
const resolveSessionFilePath = vi.hoisted(() => vi.fn())

vi.mock('./session-scanner-parse-cache', () => ({ parseAgentSessionFileCached }))
vi.mock('../native-chat/session-file-resolver', () => ({ resolveSessionFilePath }))

const { readAiVaultSessionTitlesFromFiles } = await import('./session-title-file-reader')

const roots: string[] = []

beforeEach(() => {
  parseAgentSessionFileCached.mockReset()
  resolveSessionFilePath.mockReset()
})

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true })))
})

async function transcript(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'orca-native-chat-title-'))
  roots.push(root)
  const path = join(root, 'claude-native.jsonl')
  await writeFile(path, '{}\n')
  return path
}

describe('title requests without a transcript path (native chats)', () => {
  it('finds the transcript by session id and reads Claude’s title from it', async () => {
    const path = await transcript()
    resolveSessionFilePath.mockResolvedValue(path)
    parseAgentSessionFileCached.mockResolvedValue({
      agent: 'claude',
      sessionId: 'claude-native',
      title: 'Flow 2 и 3 детермайн таск'
    })

    await expect(
      readAiVaultSessionTitlesFromFiles([{ agent: 'claude', sessionId: 'claude-native' }])
    ).resolves.toEqual({
      titles: [{ agent: 'claude', sessionId: 'claude-native', title: 'Flow 2 и 3 детермайн таск' }]
    })
    expect(resolveSessionFilePath).toHaveBeenCalledWith('claude', 'claude-native', {}, undefined)
    expect(parseAgentSessionFileCached.mock.calls[0]?.[0].file.path).toBe(path)
  })

  it('falls back to the scanner cache when no transcript is found', async () => {
    resolveSessionFilePath.mockResolvedValue(null)
    const cached = { agent: 'claude' as const, sessionId: 'claude-gone', title: 'Cached' }
    await expect(
      readAiVaultSessionTitlesFromFiles([{ agent: 'claude', sessionId: 'claude-gone' }], {
        cache: { get: () => cached, set: () => {} }
      })
    ).resolves.toEqual({ titles: [cached] })
    expect(parseAgentSessionFileCached).not.toHaveBeenCalled()
  })

  it('does not search when the request already names its transcript', async () => {
    const path = await transcript()
    parseAgentSessionFileCached.mockResolvedValue({
      agent: 'claude',
      sessionId: 'claude-hooked',
      title: 'Hooked'
    })
    await readAiVaultSessionTitlesFromFiles([
      { agent: 'claude', sessionId: 'claude-hooked', transcriptPath: path }
    ])
    expect(resolveSessionFilePath).not.toHaveBeenCalled()
  })
})
