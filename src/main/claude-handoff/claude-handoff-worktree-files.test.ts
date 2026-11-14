import { mkdtempSync, mkdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Store } from '../persistence/loading-store/store'
import {
  claudeHandoffSuccessorStarted,
  readClaudeHandoffWorktreeFile
} from './claude-handoff-worktree-files'

// Why two ids: the file is named by Claude's session id, a launch is linked by Orca's chat id.
const SESSION = '4f04db91-1411-46e9-a162-c32939fec119'
const CHAT = 'claude_f60bd2a5'
const TAB = `structured-agent-session-${CHAT}`
const WRITTEN_AT_S = 1_800_000_000
const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function workspace(repo: Record<string, unknown> | undefined = { connectionId: null }) {
  const root = mkdtempSync(join(tmpdir(), 'handoff-files-'))
  dirs.push(root)
  mkdirSync(join(root, '.claude/handoff'), { recursive: true })
  const file = join(root, `.claude/handoff/handoff-${SESSION}.md`)
  writeFileSync(file, 'the handoff')
  utimesSync(file, WRITTEN_AT_S, WRITTEN_AT_S)
  const store = { getRepo: () => repo } as unknown as Pick<Store, 'getRepo'>
  const worktreeId = `repo-1::${root}`
  return {
    store,
    worktreeId,
    handoff: (over: Record<string, unknown> = {}) => ({
      worktreeId,
      sessionId: SESSION,
      tabId: TAB as string | undefined,
      created: new Date((WRITTEN_AT_S + 60) * 1000).toISOString(),
      ...over
    })
  }
}

function chats(launched: string[]) {
  const launchedSince = vi.fn((_parent: string, _since: number) => launched)
  return { runtime: { pulseChats: () => ({ launchedSince }) }, launchedSince }
}

describe('claude handoff worktree files', () => {
  it('reads the file of a local workspace and none of an SSH host', async () => {
    const local = workspace()
    expect(
      await readClaudeHandoffWorktreeFile(
        local.store,
        local.worktreeId,
        `.claude/handoff/handoff-${SESSION}.md`
      )
    ).toBe('the handoff')
    const remote = workspace({ connectionId: 'ssh-1' })
    expect(
      await readClaudeHandoffWorktreeFile(
        remote.store,
        remote.worktreeId,
        `.claude/handoff/handoff-${SESSION}.md`
      )
    ).toBeNull()
  })

  it('counts a chat it launched since the earlier of mtime and created as the successor', async () => {
    const { store, handoff } = workspace()
    const started = chats(['claude_next'])
    expect(await claudeHandoffSuccessorStarted(store, started.runtime, handoff())).toBe(true)
    expect(started.launchedSince).toHaveBeenLastCalledWith(CHAT, WRITTEN_AT_S * 1000)
    // A `created` guessed before the write, or a file touched after the launch: the earlier wins.
    const early = new Date((WRITTEN_AT_S - 30) * 1000).toISOString()
    await claudeHandoffSuccessorStarted(store, started.runtime, handoff({ created: early }))
    expect(started.launchedSince).toHaveBeenLastCalledWith(CHAT, (WRITTEN_AT_S - 30) * 1000)
    const none = chats([])
    expect(await claudeHandoffSuccessorStarted(store, none.runtime, handoff())).toBe(false)
  })

  it('cannot tell without the chat tab, the file, on an SSH host or with pulse closed', async () => {
    const { store, handoff } = workspace()
    const started = chats(['claude_next'])
    for (const over of [{ tabId: undefined }, { tabId: 'tab-1' }, { sessionId: 'other' }]) {
      expect(await claudeHandoffSuccessorStarted(store, started.runtime, handoff(over))).toBe(false)
    }
    const remote = workspace({ connectionId: 'ssh-1' })
    expect(
      await claudeHandoffSuccessorStarted(remote.store, started.runtime, remote.handoff())
    ).toBe(false)
    const closed = {
      pulseChats: () => {
        throw new Error('pulse closed')
      }
    }
    expect(await claudeHandoffSuccessorStarted(store, closed, handoff())).toBe(false)
    expect(started.launchedSince).not.toHaveBeenCalled()
  })
})
