// Custom build (worktree-sweep): scripts/orca-plus-worktree-sweep.mjs end to end on a scratch repo, with a
// stub `orca` (ORCA_PLUS_SWEEP_ORCA) that answers from a fixture. Run:
//   node --test scripts/orca-plus-worktree-sweep.e2e.test.mjs
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  utimesSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'

const SCRIPT = join(import.meta.dirname, 'orca-plus-worktree-sweep.mjs')
const OLD = new Date(Date.now() - 3 * 86_400_000)
const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_DATE: OLD.toISOString(),
  GIT_COMMITTER_DATE: OLD.toISOString(),
  GIT_AUTHOR_NAME: 'Ann',
  GIT_AUTHOR_EMAIL: 'ann@acme.example',
  GIT_COMMITTER_NAME: 'Ann',
  GIT_COMMITTER_EMAIL: 'ann@acme.example'
}

const STUB = `#!/usr/bin/env node
import { appendFileSync, readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
const fixture = JSON.parse(readFileSync(process.env.SWEEP_STUB_FIXTURE, 'utf8'))
const args = process.argv.slice(2).filter((arg) => arg !== '--json')
appendFileSync(fixture.calls, args.join(' ') + '\\n')
const out = (result) => console.log(JSON.stringify({ ok: true, result }))
const verb = args.slice(0, 2).join(' ')
if (verb === 'worktree list') out({ worktrees: fixture.list })
else if (verb === 'repo list') out({ repos: fixture.repos })
else if (verb === 'worktree ps') {
  const n = readFileSync(fixture.calls, 'utf8').split('\\n').filter((l) => l.startsWith('worktree ps')).length
  if (fixture.hooks?.['ps:' + n]) execSync(fixture.hooks['ps:' + n])
  out({ worktrees: fixture.ps })
} else if (verb === 'worktree rm') {
  const id = args[args.indexOf('--worktree') + 1].slice(3)
  const row = fixture.list.find((w) => w.id === id)
  execSync('git -C ' + JSON.stringify(fixture.main) + ' worktree remove ' + JSON.stringify(row.path))
  out({ removed: true })
} else process.exit(1)
`

function git(cwd, ...args) {
  return execFileSync('git', ['-C', cwd, ...args], { env: GIT_ENV, encoding: 'utf8' }).trim()
}

function write(path, body) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, body)
}

/** A repo with one commit on main; worktrees are added off it, all stamped three days ago. */
function scratch() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'sweep-e2e-')))
  const main = join(dir, 'acme')
  mkdirSync(main)
  git(main, 'init', '-q', '-b', 'main')
  write(join(main, '.gitignore'), '*.csv\nstate/\n.claude/worktrees/\n')
  write(join(main, 'build', 'keep.txt'), 'tracked\n')
  write(join(main, 'docs', 'index.md'), '# Acme\n')
  git(main, 'add', '.')
  git(main, 'commit', '-q', '-m', 'acme: the first commit of the scratch repo')
  const add = (name, path = join(dir, 'wt', name)) => {
    git(main, 'worktree', 'add', '-q', '-b', name, path, 'main')
    return path
  }
  return { dir, main, add }
}

/** Git's own activity stamps of every worktree set three days back, so the day of quiet has passed. */
function ageWorktrees(main) {
  const admin = join(main, '.git', 'worktrees')
  for (const name of execFileSync('ls', [admin], { encoding: 'utf8' })
    .split('\n')
    .filter(Boolean)) {
    utimesSync(join(admin, name, 'HEAD'), OLD, OLD)
  }
}

function stub(dir, fixture) {
  const path = join(dir, 'orca-stub.mjs')
  writeFileSync(path, STUB)
  chmodSync(path, 0o755)
  const fixtureFile = join(dir, `fixture-${Date.now()}.json`)
  const calls = join(dir, `calls-${Date.now()}.txt`)
  writeFileSync(calls, '')
  writeFileSync(fixtureFile, JSON.stringify({ calls, ...fixture }))
  return { path, fixtureFile, calls }
}

function sweep(dir, orca, args) {
  const out = execFileSync(
    'node',
    [
      SCRIPT,
      '--json',
      '--apply',
      '--attic',
      join(dir, 'attic'),
      '--log',
      join(dir, 'sweep.log'),
      ...args
    ],
    {
      env: {
        ...process.env,
        ORCA_PLUS_SWEEP_ORCA: orca.path,
        SWEEP_STUB_FIXTURE: orca.fixtureFile
      },
      encoding: 'utf8',
      timeout: 120_000
    }
  )
  return JSON.parse(out)
}

const row = (id, path, extra = {}) => ({ id, path, hostId: 'local', repoId: 'r1', ...extra })
const psRow = (id, path, extra = {}) => ({ worktreeId: id, path, hostId: 'local', ...extra })

test('the night: what goes, what stays and why, on a real repo', async () => {
  const { dir, main, add } = scratch()
  const done = add('done')
  write(join(done, 'build', 'customer-export.csv'), 'ann,1\n')
  write(join(done, 'state', 'run.json'), '{"step":3}\n')
  write(join(done, 'state', 'node_modules', 'dep', 'index.js'), 'cache\n')
  const hidden = add('hidden')
  git(hidden, 'update-index', '--assume-unchanged', 'build/keep.txt')
  write(join(hidden, 'build', 'keep.txt'), 'edited, and git status says nothing\n')
  const outer = add('outer')
  const inner = add('inner', join(outer, '.claude', 'worktrees', 'inner'))
  const work = add('work')
  write(join(work, 'feature.txt'), 'new\n')
  git(work, 'add', '.')
  git(work, 'commit', '-q', '-m', 'acme: work that never reached main')
  const tab = add('tab')
  const shell = add('shell')
  const known = add('known')
  ageWorktrees(main)
  const orca = stub(dir, {
    main,
    repos: [
      { id: 'r1', path: main, kind: 'git' },
      // A git project registered on a folder inside acme, and a folder project: neither brings acme twice.
      { id: 'r2', path: join(main, 'docs'), kind: 'git' },
      { id: 'r3', path: join(main, 'docs'), kind: 'folder' }
    ],
    list: [
      row('id-main', main, { isMainWorktree: true }),
      row('id-tab', tab),
      row('id-known', known)
    ],
    ps: [
      psRow('id-main', main),
      psRow('id-tab', tab, { hasHostSidebarActivity: true }),
      // The same id and path on an SSH host, idle: it must not clear the local row's open tab.
      psRow('id-tab', tab, { hostId: 'ssh:box' }),
      psRow('id-known', known)
    ]
  })
  const sleeper = spawn('sleep', ['60'], { cwd: shell, stdio: 'ignore' })
  try {
    await new Promise((resolve) => setTimeout(resolve, 300))
    const result = sweep(dir, orca, ['--report-dir', join(dir, 'reports')])
    const byName = new Map(result.rows.map((r) => [r.path, r]))
    assert.equal(
      result.rows.length,
      byName.size,
      'every worktree once, however many projects name acme'
    )
    const reasons = (path) => byName.get(path)?.reasons ?? ['no row']
    const removed = result.results
      .filter((r) => r.result.ok)
      .map((r) => r.path)
      .sort()
    assert.deepEqual(removed, [done, inner, known].sort())
    assert.match(reasons(hidden)[0], /hidden from git status/)
    assert.equal(reasons(outer)[0], 'holds another checkout: .claude/worktrees/inner')
    assert.equal(reasons(work)[0], 'has work not in the base branch')
    assert.equal(reasons(tab)[0], 'a tab is open in it in Orca')
    assert.match(reasons(shell)[0], /^a process works in it: sleep/)
    // The removed worktree's ignored files: the export git listed under `build/`, run state, no cache.
    const doneResult = result.results.find((r) => r.path === done).result
    const listing = execFileSync('tar', ['-tzf', doneResult.copy], { encoding: 'utf8' })
    assert.match(listing, /^build\/customer-export\.csv$/m)
    assert.match(listing, /^state\/run\.json$/m)
    assert.doesNotMatch(listing, /node_modules/)
    // Its tip is kept, its branch gone; the Orca-known one went through `orca worktree rm`.
    assert.equal(git(main, 'rev-parse', doneResult.backup), git(main, 'rev-parse', 'main'))
    assert.equal(git(main, 'branch', '--list', 'done'), '')
    assert.match(
      readFileSync(orca.calls, 'utf8'),
      /^worktree rm --worktree id:id-known --delete-branch$/m
    )
    assert.ok(existsSync(join(dir, 'reports')))
    const log = readFileSync(join(dir, 'sweep.log'), 'utf8')
    assert.match(log, /"event":"run".*"readTo":\d+/)
  } finally {
    sleeper.kill()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a commit landing while the sweep copies keeps the worktree and its branch (Codex P1 24.11)', () => {
  const { dir, main, add } = scratch()
  const race = add('race')
  const stranger = add('stranger')
  ageWorktrees(main)
  const orca = stub(dir, {
    main,
    repos: [{ id: 'r1', path: main, kind: 'git' }],
    list: [row('id-main', main, { isMainWorktree: true }), row('id-race', race)],
    ps: [psRow('id-main', main), psRow('id-race', race)],
    // The second `worktree ps` is the check right before removal: an agent commits just then.
    hooks: {
      'ps:2': `git -C ${JSON.stringify(race)} commit -q --allow-empty -m "acme: a late commit"`
    }
  })
  try {
    const result = sweep(dir, orca, ['--worktree', race, '--worktree', stranger, '--closed-chat'])
    const raced = result.results.find((r) => r.path === race).result
    assert.equal(raced.ok, false)
    assert.equal(raced.err, 'HEAD moved since the check')
    assert.ok(existsSync(race))
    assert.notEqual(git(main, 'rev-parse', 'race'), git(main, 'rev-parse', 'main'))
    assert.equal(
      git(main, 'for-each-ref', 'refs/orca-plus-sweep'),
      '',
      'no backup of a removal that did not happen'
    )
    // A chat close only takes a worktree Orca itself lists.
    assert.deepEqual(result.rows.find((r) => r.path === stranger).reasons, [
      'Orca does not know it'
    ])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
