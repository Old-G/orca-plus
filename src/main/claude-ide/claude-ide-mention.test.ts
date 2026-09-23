import { describe, expect, it } from 'vitest'
import { parseClaudeIdeClientEnv, readClaudeIdeClientTerminal } from './claude-ide-client-terminal'
import { chooseClaudeIdeMentionTarget } from './claude-ide-mention-target'

describe('parseClaudeIdeClientEnv', () => {
  it('reads the Orca pane ids from ps -E tokens or /proc environ entries', () => {
    expect(
      parseClaudeIdeClientEnv([
        'claude',
        '--ide',
        'PATH=/usr/bin',
        'ORCA_TAB_ID=tab-1',
        'ORCA_PANE_KEY=tab-1:1',
        'ORCA_WORKTREE_ID=wt::/repo'
      ])
    ).toEqual({ tabId: 'tab-1', paneKey: 'tab-1:1', worktreeId: 'wt::/repo' })
  })

  it('returns null for a CLI started outside Orca', () => {
    expect(parseClaudeIdeClientEnv(['claude', 'HOME=/Users/me'])).toBeNull()
  })
})

describe('readClaudeIdeClientTerminal', () => {
  it('knows nothing on Windows rather than guessing', async () => {
    expect(await readClaudeIdeClientTerminal(process.pid, 'win32')).toBeNull()
  })
})

describe('chooseClaudeIdeMentionTarget', () => {
  const inA = { id: 'a', connectedAt: 1, terminal: { worktreeId: 'wt-a' } }
  const newerInA = { id: 'a2', connectedAt: 3, terminal: { worktreeId: 'wt-a' } }
  const inB = { id: 'b', connectedAt: 5, terminal: { worktreeId: 'wt-b' } }
  const unknown = { id: 'x', connectedAt: 4, terminal: null }

  it('prefers the newest CLI in the file worktree over newer CLIs elsewhere', () => {
    expect(chooseClaudeIdeMentionTarget([inA, inB, newerInA, unknown], 'wt-a')?.id).toBe('a2')
  })

  it('falls back to the newest CLI when none runs in that worktree', () => {
    expect(chooseClaudeIdeMentionTarget([inA, inB, unknown], 'wt-c')?.id).toBe('b')
    expect(chooseClaudeIdeMentionTarget([inA, unknown], undefined)?.id).toBe('x')
  })

  it('has no target without connected CLIs', () => {
    expect(chooseClaudeIdeMentionTarget([], 'wt-a')).toBeNull()
  })
})
