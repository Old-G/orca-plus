// Custom build (worktree-sweep): the pure rules of scripts/orca-plus-worktree-sweep.mjs.
// Run: node --test scripts/orca-plus-worktree-sweep.test.mjs
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  backupRefDay,
  firstReflogCommit,
  isBackupExpired,
  keepReasons,
  lastReflogAt,
  normalizeSubject,
  parseWorktreePorcelain,
  subjectsLanded
} from './orca-plus-worktree-sweep.mjs'

const HOUR = 3_600_000
const finished = {
  isMain: false,
  bare: false,
  underRoot: true,
  locked: false,
  pinned: false,
  liveAgent: false,
  liveTerminal: false,
  minIdleMs: 24 * HOUR,
  idleMs: 48 * HOUR,
  dirtyCount: 0,
  landedIn: 'main (merged)'
}

test('a finished worktree goes', () => {
  assert.deepEqual(keepReasons(finished), [])
})

test('each guard alone keeps it', () => {
  const cases = [
    [{ isMain: true }, 'main checkout'],
    [{ underRoot: false }, 'outside the workspace folder'],
    [{ locked: true }, 'locked'],
    [{ pinned: true }, 'pinned in Orca'],
    [{ liveAgent: true }, 'an agent is still working'],
    [{ liveTerminal: true }, 'a terminal is live'],
    [{ idleMs: 3 * HOUR }, 'active 3 h ago'],
    [{ dirtyCount: 2 }, '2 uncommitted file(s)'],
    [{ dirtyCount: null }, 'git status unreadable'],
    [{ landedIn: null }, 'has work not in the base branch']
  ]
  for (const [patch, reason] of cases) {
    assert.deepEqual(keepReasons({ ...finished, ...patch }), [reason], JSON.stringify(patch))
  }
})

test('git findings are not reported once a cheap guard already keeps it (they were never read)', () => {
  assert.deepEqual(
    keepReasons({ ...finished, liveAgent: true, dirtyCount: null, landedIn: null }),
    ['an agent is still working']
  )
})

test('unknown idle time does not keep it by itself', () => {
  assert.deepEqual(keepReasons({ ...finished, idleMs: null }), [])
})

test('subjects: fixups land as the commit they fix, short subjects prove nothing', () => {
  assert.equal(
    normalizeSubject('fixup! squash! custom(x): a long enough subject'),
    'custom(x): a long enough subject'
  )
  const base = ['custom(hq-inbox): the Inbox is one stream, oldest first', 'wip']
  assert.equal(
    subjectsLanded(['fixup! custom(hq-inbox): the Inbox is one stream, oldest first'], base),
    true
  )
  assert.equal(subjectsLanded(['wip'], base), false)
  assert.equal(
    subjectsLanded(['custom(hq-inbox): something that never landed anywhere'], base),
    false
  )
  assert.equal(subjectsLanded([], base), false)
})

test('porcelain parsing keeps branch, detached, locked and prunable', () => {
  const text = [
    'worktree /repo',
    'HEAD aaa',
    'branch refs/heads/main',
    '',
    'worktree /ws/a',
    'HEAD bbb',
    'detached',
    'locked reason here',
    '',
    'worktree /ws/b',
    'HEAD ccc',
    'branch refs/heads/feat/x',
    'prunable gitdir file points to non-existent location',
    ''
  ].join('\n')
  const [main, a, b] = parseWorktreePorcelain(text)
  assert.equal(main.branch, 'main')
  assert.equal(a.detached, true)
  assert.equal(a.locked, true)
  assert.equal(a.branch, null)
  assert.equal(b.branch, 'feat/x')
  assert.equal(b.prunable, true)
})

test('reflog: newest entry time and the commit the worktree started at', () => {
  const sha = (c) => c.repeat(40)
  const text =
    `${sha('0')} ${sha('a')} Ann <ann@acme.example> 1793727387 +0300\t\n` +
    `${sha('a')} ${sha('b')} Ann <ann@acme.example> 1793727396 +0300\treset: moving to HEAD\n` +
    `${sha('b')} ${sha('c')} Ann <ann@acme.example> 1794000806 -0500\tcommit: x\n`
  assert.equal(lastReflogAt(text), 1794000806 * 1000)
  assert.equal(firstReflogCommit(text), sha('a'))
  assert.equal(lastReflogAt(''), 0)
  assert.equal(firstReflogCommit(''), null)
})

test('backup refs expire after 30 days', () => {
  const ref = 'refs/orca-plus-sweep/20261001/Old/feat'
  assert.equal(backupRefDay(ref), '20261001')
  assert.equal(isBackupExpired(ref, Date.UTC(2026, 9, 20)), false)
  assert.equal(isBackupExpired(ref, Date.UTC(2026, 10, 2)), true)
  assert.equal(isBackupExpired('refs/heads/main', Date.UTC(2030, 0, 1)), false)
})
