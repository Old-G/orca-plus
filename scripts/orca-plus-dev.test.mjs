// Custom build (dev-port): one DEV per machine — a second start refuses with the first one's address.
// Run: node --test scripts/orca-plus-dev.test.mjs
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

const script = new URL('./orca-plus-dev.sh', import.meta.url).pathname
const lstart = (pid) =>
  spawnSync('ps', ['-o', 'lstart=', '-p', String(pid)], { encoding: 'utf8' }).stdout.trim()

function run(ownerFile, args = ['--check']) {
  return spawnSync('bash', [script, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ORCA_DEV_OWNER_FILE: ownerFile }
  })
}

test('free: no claim file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dev-port-'))
  const r = run(join(dir, 'owner'))
  assert.equal(r.status, 0)
  assert.match(r.stdout, /DEV is free/)
  rmSync(dir, { recursive: true })
})

test('free: claim of a dead pid is ignored', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dev-port-'))
  const owner = join(dir, 'owner')
  writeFileSync(owner, '999999\nMon Jan  1 00:00:00 2001\n/x\n-\n')
  assert.equal(run(owner).status, 0)
  rmSync(dir, { recursive: true })
})

test('free: live pid but another process start time (pid reuse)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dev-port-'))
  const owner = join(dir, 'owner')
  writeFileSync(owner, `${process.pid}\nMon Jan  1 00:00:00 2001\n/x\n-\n`)
  assert.equal(run(owner).status, 0)
  rmSync(dir, { recursive: true })
})

test('taken: exits 2 with pid, worktree, CDP address and log', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dev-port-'))
  const tree = join(dir, 'tree')
  mkdirSync(join(tree, 'out'), { recursive: true })
  writeFileSync(
    join(tree, 'out', 'dev-instance.json'),
    '{\n  "cdpUrl": "http://127.0.0.1:9777"\n}\n'
  )
  const owner = join(dir, 'owner')
  const sleeper = spawn('sleep', ['30'])
  try {
    writeFileSync(owner, `${sleeper.pid}\n${lstart(sleeper.pid)}\n${tree}\n/tmp/first.log\n`)
    for (const args of [['--check'], ['--detach']]) {
      const r = run(owner, args)
      assert.equal(r.status, 2)
      assert.match(r.stderr, new RegExp(`pid ${sleeper.pid}`))
      assert.match(r.stderr, new RegExp(tree))
      assert.match(r.stderr, /CDP http:\/\/127\.0\.0\.1:9777/)
      assert.match(r.stderr, /first\.log/)
    }
  } finally {
    sleeper.kill()
    rmSync(dir, { recursive: true })
  }
})
