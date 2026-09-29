import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { filterAiVaultSessions } from '../../shared/ai-vault-session-filters'
import { scanAiVaultSessions } from './session-scanner'
import { isolatedScanRoots, writeJsonlFile } from './session-scanner-test-fixtures'

let tempRoots: string[] = []

afterEach(async () => {
  await Promise.all(tempRoots.map((root) => rm(root, { recursive: true, force: true })))
  tempRoots = []
})

function turn(sessionId: string, entrypoint: string, text: string, minute: number) {
  return [
    {
      type: 'user',
      sessionId,
      entrypoint,
      timestamp: `2026-09-29T10:0${minute}:00.000Z`,
      cwd: '/tmp/project',
      message: { role: 'user', content: text }
    },
    {
      type: 'assistant',
      sessionId,
      entrypoint,
      timestamp: `2026-09-29T10:0${minute}:30.000Z`,
      cwd: '/tmp/project',
      message: { role: 'assistant', content: [{ type: 'text', text: 'done' }] }
    }
  ]
}

describe('automated (SDK script) Claude sessions', () => {
  it('marks Python Agent SDK sessions and hides them from history unless asked', async () => {
    const root = await mkdtemp(join(tmpdir(), 'orca-ai-vault-automated-'))
    tempRoots.push(root)
    const roots = isolatedScanRoots(root)
    const projectDir = join(roots.claudeProjectsDir, 'project')
    await writeJsonlFile(
      join(projectDir, 'review.jsonl'),
      turn('review', 'sdk-py', 'Review this change for security vulnerabilities.', 1)
    )
    await writeJsonlFile(
      join(projectDir, 'chat.jsonl'),
      turn('chat', 'sdk-ts', 'Лор прислала опять тикеты', 2)
    )
    await writeJsonlFile(join(projectDir, 'print.jsonl'), turn('print', 'sdk-cli', 'отчёт', 3))

    const result = await scanAiVaultSessions({ ...roots, platform: 'darwin' })
    const byId = new Map(result.sessions.map((session) => [session.sessionId, session]))
    expect(byId.get('review')?.automated).toBe(true)
    expect(byId.get('chat')?.automated).toBeUndefined()
    // `claude -p` is also used by people; only the Python SDK counts as automated.
    expect(byId.get('print')?.automated).toBeUndefined()

    const base = {
      query: '',
      agents: ['claude'] as const,
      scope: 'all' as const,
      sort: 'updated' as const,
      activeWorktreePaths: [],
      hideEmptySessions: false
    }
    const shown = (hideAutomatedSessions?: boolean) =>
      filterAiVaultSessions(result.sessions, { ...base, hideAutomatedSessions })
        .map((session) => session.sessionId)
        .sort()
    expect(shown()).toEqual(['chat', 'print'])
    expect(shown(true)).toEqual(['chat', 'print'])
    expect(shown(false)).toEqual(['chat', 'print', 'review'])
  })
})
