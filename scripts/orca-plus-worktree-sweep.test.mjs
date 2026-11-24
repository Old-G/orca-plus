// Custom build (worktree-sweep): the pure rules and the report of scripts/orca-plus-worktree-sweep.mjs.
// Run: node --test scripts/orca-plus-worktree-sweep.test.mjs
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  backupRefDay,
  backupRefName,
  checkoutInside,
  copyFileName,
  firstReflogCommit,
  formatBytes,
  isBackupExpired,
  isCacheName,
  keepReasons,
  lastReflogAt,
  missingFromListing,
  normalizeSubject,
  parseHiddenTracked,
  parseLsofCwd,
  parseStatusZ,
  parseWorktreePorcelain,
  processInside,
  subjectsLanded
} from './orca-plus-worktree-sweep-rules.mjs'
import {
  closesSince,
  isoWeek,
  mergeWeekReport,
  reasonGroup,
  renderNight
} from './orca-plus-worktree-sweep-report.mjs'
import { archiveManifest, ignoredManifest } from './orca-plus-worktree-sweep-files.mjs'

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
  hiddenCount: 0,
  landedIn: 'main (merged)'
}

test('a finished worktree goes', () => {
  assert.deepEqual(keepReasons(finished), [])
})

test('each guard alone keeps it', () => {
  const cases = [
    [{ isMain: true }, 'main checkout'],
    [{ underRoot: false }, 'outside --root'],
    [{ locked: true }, 'locked'],
    [{ pinned: true }, 'pinned in Orca'],
    [{ orcaUnread: true }, 'Orca did not report its agents'],
    [{ liveAgent: true }, 'an agent is still working'],
    [{ liveTerminal: true }, 'a terminal is live'],
    [{ onScreen: true }, 'open on screen in Orca'],
    [{ openTab: true }, 'a tab is open in it in Orca'],
    [{ orcaUnknown: true }, 'Orca does not know it'],
    [{ orcaTwice: true }, 'Orca lists it more than once'],
    [{ holdsCheckout: '.claude/worktrees/x' }, 'holds another checkout: .claude/worktrees/x'],
    [{ liveProcess: 'zsh (pid 7)' }, 'a process works in it: zsh (pid 7)'],
    [{ processesUnread: true }, 'running processes unread (lsof)'],
    [{ idleMs: 3 * HOUR }, 'active 3 h ago'],
    [{ dirtyCount: 2 }, '2 uncommitted file(s)'],
    [{ dirtyCount: null }, 'git status unreadable'],
    [{ hiddenCount: null }, 'git index unreadable'],
    [
      { hiddenCount: 1 },
      '1 tracked file(s) hidden from git status (assume-unchanged, skip-worktree)'
    ],
    [{ landedIn: null }, 'has work not in the base branch'],
    [{ nestedCheckout: 'state/clone' }, 'holds another checkout: state/clone'],
    [{ ignoredUnreadable: 'state/locked' }, 'ignored files unreadable: state/locked'],
    [
      { copyTooBig: 'over 1.0 GB' },
      'over 1.0 GB of ignored files beyond caches — too big to keep a copy'
    ]
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

test('status -z: edits keep it, ignored caches are not copied, other ignored files are', () => {
  const text = [
    ' M src/a.ts',
    'R  new.ts',
    'old.ts',
    '?? notes.md',
    '!! node_modules/',
    '!! src/x/__pycache__/',
    '!! state/',
    '!! .env',
    '!! with space/out.json',
    '!! lib/a.pyc',
    ''
  ].join('\0')
  const { dirty, ignored } = parseStatusZ(text)
  assert.deepEqual(dirty, ['src/a.ts', 'new.ts', 'notes.md'])
  assert.deepEqual(ignored, ['state/', '.env', 'with space/out.json'])
  assert.deepEqual(parseStatusZ(''), { dirty: [], ignored: [] })
  assert.equal(isCacheName('node_modules'), true)
  assert.equal(isCacheName('pkg.egg-info'), true)
  assert.equal(isCacheName('state'), false)
})

test('lsof: a process whose working folder is the worktree or inside it keeps it; git passes', () => {
  const text = [
    'p11',
    'czsh',
    'fcwd',
    'n/ws/a',
    'p12',
    'cgit',
    'fcwd',
    'n/ws/b',
    'p13',
    'cclaude',
    'fcwd',
    'n/ws/c/sub',
    'p14',
    'cnode',
    'fcwd',
    'n/ws/cc',
    ''
  ].join('\n')
  const procs = parseLsofCwd(text)
  assert.equal(procs.length, 4)
  assert.equal(processInside(procs, '/ws/a', 1), 'zsh (pid 11)')
  assert.equal(processInside(procs, '/ws/b', 1), null)
  assert.equal(processInside(procs, '/ws/c', 1), 'claude (pid 13)')
  // `/ws/cc` is not inside `/ws/c`.
  assert.equal(processInside([procs[3]], '/ws/c', 1), null)
  // The sweep's own process does not count.
  assert.equal(processInside(procs, '/ws/a', 11), null)
})

test('copy names: one per checkout path, so two `qa` folders at one tip never share a copy (Codex P1 24.11)', () => {
  const head = 'a'.repeat(40)
  assert.match(
    copyFileName('lh agents', '/x/.claude/worktrees/hub qa', head),
    /^lh_agents--hub_qa-aaaaaaaaaaaa-[0-9a-f]{8}\.tar\.gz$/
  )
  assert.notEqual(
    copyFileName('acme', '/x/acme/.claude/worktrees/qa', head),
    copyFileName('acme', '/home/ann/.hc-work/qa', head)
  )
  assert.equal(
    copyFileName('acme', '/x/qa', head),
    copyFileName('acme', '/x/qa', head),
    'the same path names the same copy'
  )
  assert.equal(formatBytes(5 * 1024 ** 2), '5 MB')
  assert.equal(formatBytes(1.5 * 1024 ** 3), '1.5 GB')
})

test('ISO weeks start on Monday', () => {
  assert.equal(isoWeek(new Date(2026, 10, 24, 4).getTime()), '2026-W48')
  assert.equal(isoWeek(new Date(2026, 10, 29, 23).getTime()), '2026-W48')
  assert.equal(isoWeek(new Date(2026, 10, 30, 1).getTime()), '2026-W49')
  assert.equal(isoWeek(new Date(2027, 0, 1, 12).getTime()), '2026-W53')
})

test('report: removed by repo, kept by reason, the newest run on top', () => {
  assert.equal(reasonGroup('active 3 h ago'), 'active in the last day')
  assert.equal(reasonGroup('2 uncommitted file(s)'), 'uncommitted files')
  assert.equal(reasonGroup('locked'), 'locked')
  const night = (day, removed) =>
    renderNight({
      now: new Date(2026, 10, day, 4, 0).getTime(),
      removed,
      kept: [
        { repo: 'acme', name: 'feat-a', reason: 'active 3 h ago' },
        { repo: 'acme', name: 'feat-b', reason: 'has work not in the base branch' },
        { repo: 'acme', name: 'feat-c', reason: 'a process works in it: zsh (pid 7)' }
      ],
      onClose: { removed: ['acme · chat-1'], kept: ['acme · chat-2: locked'] },
      copies: 1,
      attic: '~/copies'
    })
  const first = night(24, [
    { repo: 'acme', name: 'one' },
    { repo: 'acme', name: 'two' },
    { repo: 'tools', name: 'three' }
  ])
  assert.match(first, /^## 24\.11 04:00 — removed 3, kept 3$/m)
  assert.match(first, /^- acme \(2\): one, two$/m)
  assert.match(first, /^- active in the last day \(1\): acme · feat-a \(active 3 h ago\)$/m)
  assert.match(first, /^- has work not in the base branch \(1\): acme · feat-b$/m)
  assert.match(first, /removed 1 \(acme · chat-1\), kept 1 \(acme · chat-2: locked\)/)
  assert.match(first, /^- a process works in it \(1\): acme · feat-c \(zsh \(pid 7\)\)$/m)
  const week = mergeWeekReport(null, new Date(2026, 10, 24, 4).getTime(), first)
  assert.match(week, /^# Worktree cleanup · 2026-W48\n/)
  const next = mergeWeekReport(
    week,
    new Date(2026, 10, 25, 4).getTime(),
    night(25, [{ repo: 'acme', name: 'four' }])
  )
  assert.ok(next.indexOf('## 25.11') < next.indexOf('## 24.11'))
  assert.equal(next.match(/^---$/gm).length, 1)
  const rerun = mergeWeekReport(next, new Date(2026, 10, 25, 9).getTime(), night(25, []))
  // A second run the same day adds its own section; the first one's removals stay in the report.
  assert.equal(rerun.match(/^## 25\.11/gm).length, 2)
  assert.match(rerun, /^- acme \(1\): four$/m)
  assert.equal(rerun.match(/^## 24\.11/gm).length, 1)
  assert.equal(rerun.match(/^---$/gm).length, 1)
})

test('chat closes are reported once: since the last sweep run, not the last 24 h', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sweep-log-'))
  const log = join(dir, 'log.jsonl')
  const at = (h) => new Date(Date.UTC(2026, 10, 24, h)).toISOString()
  const lines = [
    { at: at(1), event: 'removed', trigger: 'chat-close', repo: 'acme', path: '/w/old' },
    { at: at(2), event: 'run', trigger: 'sweep' },
    { at: at(3), event: 'removed', trigger: 'chat-close', repo: 'acme', path: '/w/new' },
    {
      at: at(4),
      event: 'kept',
      trigger: 'chat-close',
      repo: 'acme',
      path: '/w/k',
      reasons: ['locked']
    },
    { at: at(5), event: 'removed', trigger: 'sweep', repo: 'acme', path: '/w/night' }
  ].map((entry) => JSON.stringify(entry))
  writeFileSync(log, `${lines.join('\n')}\nnot json\n`)
  const first = closesSince(log, 0)
  assert.deepEqual(first.removed, ['acme · new'])
  assert.deepEqual(first.kept, ['acme · k: locked'])
  assert.deepEqual(closesSince(join(dir, 'missing'), 0), { removed: [], kept: [], readTo: 0 })
  rmSync(dir, { recursive: true, force: true })
})

test('the next report starts where the last one read the log, whatever the time stamps (Codex P3 24.11)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sweep-log-'))
  const log = join(dir, 'log.jsonl')
  const line = (entry) => `${JSON.stringify(entry)}\n`
  const close = (name, at) => ({
    at,
    event: 'removed',
    trigger: 'chat-close',
    repo: 'acme',
    path: `/w/${name}`
  })
  writeFileSync(log, line(close('before', '2026-11-24T00:30:00Z')))
  const read = closesSince(log, 0)
  assert.deepEqual(read.removed, ['acme · before'])
  // A close that started at 03:59 and finished after the night read the log, stamped before the run.
  appendFileSync(log, line(close('late', '2026-11-24T00:59:00Z')))
  appendFileSync(log, line({ at: '2026-11-24T01:00:00Z', event: 'run', readTo: read.readTo }))
  appendFileSync(
    log,
    line({ ...close('failed', '2026-11-24T02:00:00Z'), event: 'failed', step: 'remove' })
  )
  const next = closesSince(log, 0)
  assert.deepEqual(next.removed, ['acme · late'])
  assert.deepEqual(next.kept, ['acme · failed: removal failed at remove'])
  rmSync(dir, { recursive: true, force: true })
})

test('notes written below the footer survive the next night (Codex P3 24.11)', () => {
  const now = new Date(2026, 10, 24, 4).getTime()
  const night = (title) => `## ${title} — removed 0, kept 0\n`
  const week = mergeWeekReport(null, now, night('24.11 04:00'))
  const noted = `${week}\nDecided 24.11: keep acme · feat-b until Friday.\n`
  const next = mergeWeekReport(noted, now + 86_400_000, night('25.11 04:00'))
  assert.match(next, /Decided 24\.11: keep acme · feat-b until Friday\.\n$/)
  assert.ok(next.indexOf('## 25.11') < next.indexOf('## 24.11'))
  assert.equal(next.match(/^---$/gm).length, 1)
  assert.equal(next.match(/Decided 24\.11/g).length, 1)
})

test('hidden tracked files, tar listings and nested checkouts', () => {
  const listed = ['H src/a.ts', 'h config/local.json', 'S sparse/b.ts', 'M conflict.ts', ''].join(
    '\0'
  )
  assert.deepEqual(parseHiddenTracked(listed), ['config/local.json', 'sparse/b.ts'])
  assert.deepEqual(parseHiddenTracked(''), [])
  assert.deepEqual(missingFromListing(['state', 'state/a', 'b.csv'], 'state/\nstate/a\n'), [
    'b.csv'
  ])
  assert.deepEqual(missingFromListing(['x'], './x\n'), [])
  const checkouts = ['/w/qa', '/w/qa/.claude/worktrees/inner', '/w/qa-2']
  assert.equal(checkoutInside(checkouts, '/w/qa'), '.claude/worktrees/inner')
  assert.equal(checkoutInside(checkouts, '/w/qa-2'), null)
  assert.equal(reasonGroup('holds another checkout: x'), 'holds another checkout')
})

test('the manifest keeps a file git lists under a cache-named folder; caches below a listed folder stay out (Codex P1 24.11)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sweep-files-'))
  const wt = join(dir, 'wt')
  const files = {
    'build/customer-export.csv': 'ann,1\n',
    'state/run.json': '{}',
    'state/node_modules/dep/index.js': 'x',
    'state/sub/build/out.bin': 'y'
  }
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(join(wt, rel, '..'), { recursive: true })
    writeFileSync(join(wt, rel), body)
  }
  const manifest = ignoredManifest(wt, ['build/customer-export.csv', 'state/'], 1024 ** 2)
  assert.deepEqual(manifest.paths, [
    'build/customer-export.csv',
    'state',
    'state/run.json',
    'state/sub'
  ])
  assert.equal(manifest.over, false)
  assert.equal(manifest.nested, null)
  assert.equal(ignoredManifest(wt, ['state/'], 1).over, true)
  assert.equal(ignoredManifest(wt, ['state/'], 1024 ** 2, 1).over, true)
  mkdirSync(join(wt, 'state', 'clone', '.git'), { recursive: true })
  assert.equal(ignoredManifest(wt, ['state/'], 1024 ** 2).nested, 'state/clone')
  rmSync(join(wt, 'state', 'clone'), { recursive: true })
  // The copy holds every manifest path, and a second copy of the same checkout gets its own file.
  const attic = join(dir, 'attic')
  const args = {
    repo: 'acme',
    wtPath: wt,
    head: 'a'.repeat(40),
    paths: manifest.paths,
    now: 0,
    attic
  }
  const one = archiveManifest(args)
  const two = archiveManifest(args)
  assert.equal(one.ok, true)
  assert.notEqual(one.copy, two.copy)
  const listing = execFileSync('tar', ['-tzf', one.copy], { encoding: 'utf8' })
  assert.deepEqual(missingFromListing(manifest.paths, listing), [])
  assert.ok(!listing.includes('node_modules'))
  assert.ok(listing.includes('build/customer-export.csv'))
  // A manifest path tar cannot read fails the copy rather than passing short.
  assert.equal(archiveManifest({ ...args, paths: ['gone.txt'] }).ok, false)
  rmSync(dir, { recursive: true, force: true })
})
