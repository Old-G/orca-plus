import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { formatShipRange, parseShipLog, readShipRange, SHIP_LOG_FORMAT } from './hq-ship-range'

const US = '\u001f'

function fakeGit(answers: Record<string, string | Error>) {
  return (args: string[]): string => {
    const value = answers[args.join(' ')]
    if (value === undefined || value instanceof Error) {
      throw value ?? new Error(`unexpected git ${args.join(' ')}`)
    }
    return value
  }
}

describe('ship range', () => {
  it('parses the log rows, keeping a subject that holds the separator', () => {
    expect(parseShipLog(`abc${US}Ann${US}fix: a${US}b\n\ndef${US}Bob${US}feat`)).toEqual([
      { sha: 'abc', author: 'Ann', subject: `fix: a${US}b` },
      { sha: 'def', author: 'Bob', subject: 'feat' }
    ])
  })

  it('lists the commits between the last ship and the target', () => {
    const git = fakeGit({
      'config --get orca.shipped': 'aaa111',
      'config --get orca.shipTarget': 'origin/custom',
      [`log --reverse --format=${SHIP_LOG_FORMAT} --end-of-options aaa111..origin/custom`]: `b1${US}Ann${US}one\nb2${US}Bob${US}two`
    })
    const range = readShipRange('/x', {}, git)
    expect(range).toEqual({
      ok: true,
      since: 'aaa111',
      target: 'origin/custom',
      commits: [
        { sha: 'b1', author: 'Ann', subject: 'one' },
        { sha: 'b2', author: 'Bob', subject: 'two' }
      ]
    })
    expect(formatShipRange(range)).toContain('b2 Bob — two')
    expect(formatShipRange(range)).toContain('(aaa111..origin/custom, 2)')
  })

  it('flags take precedence over git config', () => {
    const git = fakeGit({
      [`log --reverse --format=${SHIP_LOG_FORMAT} --end-of-options v1..main`]: ''
    })
    const range = readShipRange('/x', { since: 'v1', target: 'main' }, git)
    expect(range).toMatchObject({ ok: true, commits: [] })
    expect(formatShipRange(range)).toContain('none')
  })

  it('says why when nothing is recorded, and does not throw', () => {
    const range = readShipRange(
      '/x',
      {},
      fakeGit({ 'config --get orca.shipped': new Error('exit 1') })
    )
    expect(range).toEqual({
      ok: false,
      reason: 'no last-shipped commit (git config orca.shipped, or --since <ref>)'
    })
    expect(formatShipRange(range)).toContain('unknown')
  })

  it('rejects a last-shipped ref that is not a commit', () => {
    const git = fakeGit({
      'config --get orca.shipped': 'gone',
      'config --get orca.shipTarget': 'origin/custom',
      [`log --reverse --format=${SHIP_LOG_FORMAT} --end-of-options gone..origin/custom`]: new Error(
        'bad revision'
      ),
      'rev-parse --verify --quiet gone^{commit}': new Error('exit 1')
    })
    expect(readShipRange('/x', {}, git)).toEqual({ ok: false, reason: 'gone is not a commit here' })
  })

  it('says so when no target is configured', () => {
    const git = fakeGit({ 'config --get orca.shipped': 'aaa' })
    expect(readShipRange('/x', {}, git)).toEqual({
      ok: false,
      reason: 'no target branch (git config orca.shipTarget, or --target <ref>)'
    })
  })

  it('says the target is unknown when only it is bad', () => {
    const git = fakeGit({
      'config --get orca.shipped': 'aaa',
      'config --get orca.shipTarget': 'origin/nope',
      [`log --reverse --format=${SHIP_LOG_FORMAT} --end-of-options aaa..origin/nope`]: new Error(
        'bad'
      ),
      'rev-parse --verify --quiet aaa^{commit}': 'aaa'
    })
    expect(readShipRange('/x', {}, git)).toEqual({
      ok: false,
      reason: 'origin/nope is not a ref here'
    })
  })

  it('cuts a long list', () => {
    const commits = Array.from({ length: 20 }, (_, i) => ({
      sha: `s${i}`,
      author: 'A',
      subject: `c${i}`
    }))
    const text = formatShipRange({ ok: true, since: 'a', target: 'b', commits })
    expect(text).toContain('… and 5 more')
    expect(text).not.toContain('s19')
  })
})

describe('ship range on a real repository', () => {
  it('lists the commits after orca.shipped and nothing after a ship', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ship-range-'))
    try {
      const git = (...args: string[]): string =>
        execFileSync('git', ['-c', 'user.name=Ann', '-c', 'user.email=a@acme.example', ...args], {
          cwd: dir,
          encoding: 'utf8'
        }).trim()
      git('init', '-q', '-b', 'custom')
      git('commit', '-q', '--allow-empty', '-m', 'first')
      git('config', 'orca.shipped', git('rev-parse', 'HEAD'))
      git('config', 'orca.shipTarget', 'custom')
      git('commit', '-q', '--allow-empty', '-m', "Bob's change")
      git('commit', '-q', '--allow-empty', '-m', 'second')
      const range = readShipRange(dir, {})
      expect(range.ok && range.commits.map((c) => c.subject)).toEqual(["Bob's change", 'second'])
      git('config', 'orca.shipped', git('rev-parse', 'HEAD'))
      expect(readShipRange(dir, {})).toMatchObject({ ok: true, commits: [] })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
