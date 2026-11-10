// Custom build (worktree-sweep): the pure rules of scripts/orca-plus-worktree-sweep.mjs.
// Run: node --test scripts/orca-plus-worktree-sweep.test.mjs
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { test } from 'node:test'
import {
  backupRefDay,
  backupRefName,
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
    [{ orcaUnread: true }, 'Orca did not report its agents'],
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

test('backup ref names differ per tip and never clash as file and folder', () => {
  const a = backupRefName('20261110', 'feat/x', 'a'.repeat(40))
  const b = backupRefName('20261110', 'feat/x', 'b'.repeat(40))
  assert.notEqual(a, b)
  assert.equal(a, 'refs/orca-plus-sweep/20261110/feat%2Fx-aaaaaaaaaaaa')
  assert.equal(backupRefDay(a), '20261110')
  assert.ok(!backupRefName('20261110', 'feat/x/y', 'c'.repeat(40)).startsWith(`${a}/`))
})

test('a branch whose name carries another backup name plus a slash cannot nest under it (Codex P2 10.11)', () => {
  const first = backupRefName('20261110', 'feat/x', `aaaaaaaaaaaa${'0'.repeat(28)}`)
  const second = backupRefName('20261110', 'feat/x-aaaaaaaaaaaa/y', 'b'.repeat(40))
  assert.ok(!second.startsWith(`${first}/`))
  // One component under the day: no backup ref can be the folder of another.
  for (const ref of [first, second, backupRefName('20261110', 'a%2Fb', 'c'.repeat(40))]) {
    assert.equal(ref.slice('refs/orca-plus-sweep/20261110/'.length).includes('/'), false)
  }
  // `%` is encoded too, so `a/b` and a branch literally named `a%2Fb` stay apart.
  assert.notEqual(
    backupRefName('20261110', 'a/b', 'c'.repeat(40)),
    backupRefName('20261110', 'a%2Fb', 'c'.repeat(40))
  )
})

test('a long branch keeps its backup ref component within the 255-byte file name limit (Codex P2 11.11)', () => {
  const day = '20261110'
  const head = 'a'.repeat(40)
  const component = (ref) => ref.slice(`refs/orca-plus-sweep/${day}/`.length)
  const long = `feature/${'x'.repeat(120)}/${'y'.repeat(120)}`
  const ref = backupRefName(day, long, head)
  // git writes `<component>.lock` next to the ref, so the component plus 5 bytes must fit in 255.
  assert.ok(Buffer.byteLength(component(ref)) + '.lock'.length <= 255, component(ref))
  assert.equal(component(ref).includes('/'), false)
  assert.equal(backupRefDay(ref), day)
  assert.ok(ref.endsWith(`-${head.slice(0, 12)}`))
  // Two long names that share the kept prefix stay apart.
  assert.notEqual(ref, backupRefName(day, `${long}z`, head))
  // Multi-byte names are cut on a character boundary.
  const cyr = backupRefName(day, `фича/${'я'.repeat(200)}`, head)
  assert.ok(Buffer.byteLength(component(cyr)) + '.lock'.length <= 255)
  assert.equal(Buffer.from(component(cyr)).toString('utf8'), component(cyr))
  assert.equal(component(cyr).includes('�'), false)
  // A shortened name never equals the backup of a different, short branch.
  assert.ok(component(ref).includes('%h'))
  assert.equal(component(backupRefName(day, 'feat/x', head)).includes('%h'), false)
})

test('a shortened backup ref is accepted by git', () => {
  const ref = backupRefName(
    '20261110',
    `feature/${'x'.repeat(120)}/${'%'.repeat(80)}`,
    'b'.repeat(40)
  )
  assert.doesNotThrow(() => execFileSync('git', ['check-ref-format', ref], { stdio: 'ignore' }))
})
