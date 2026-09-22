#!/usr/bin/env node
// Checks that a rebase of our feature stack onto new upstream lost none of our changes.
//
//   sync-upstream-guard.mjs <old-base> <old-tip> <new-base> <new-tip>
//
// A line the old stack added is kept when the new tip still has it in the same file, or the new
// stack adds it anywhere (a file upstream moved). Every other one is reported with the commit and
// feature that added it. Commits whose subject vanished are reported too (upstream may have
// merged them — check). Exit 0 clean · 1 something to explain · 2 bad input.
import { execFileSync } from 'node:child_process'

const [oldBase, oldTip, newBase, newTip] = process.argv.slice(2)
if (!newTip) {
  console.error('usage: sync-upstream-guard.mjs <old-base> <old-tip> <new-base> <new-tip>')
  process.exit(2)
}

const git = (...args) =>
  execFileSync('git', args, { encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024 })

// Lines that carry no feature on their own: braces, blank, short punctuation.
const meaningful = (line) => line.length >= 4 && /[A-Za-z0-9]/.test(line)

// Parses `git diff/log -p -U0` output into commit -> { file -> Set(trimmed added lines) }.
function parsePatch(text) {
  let commit = null
  let file = null
  const perCommit = new Map()
  for (const raw of text.split('\n')) {
    if (raw.startsWith('COMMIT ')) {
      commit = raw.slice(7)
      perCommit.set(commit, new Map())
      file = null
    } else if (raw.startsWith('+++ ')) {
      file = raw === '+++ /dev/null' ? null : raw.replace(/^\+\+\+ b\//, '')
    } else if (file && raw.startsWith('+') && !raw.startsWith('+++')) {
      const line = raw.slice(1).trim()
      if (!meaningful(line)) {
        continue
      }
      const files = perCommit.get(commit ?? '') ?? new Map()
      perCommit.set(commit ?? '', files)
      if (!files.has(file)) {
        files.set(file, new Set())
      }
      files.get(file).add(line)
    }
  }
  return perCommit
}

const oldStack = parsePatch(git('diff', '-U0', '--no-color', '--no-renames', oldBase, oldTip)).get(
  ''
)
const newStack = parsePatch(git('diff', '-U0', '--no-color', '--no-renames', newBase, newTip)).get(
  ''
)
const oldCommits = parsePatch(
  git(
    'log',
    '-p',
    '-U0',
    '--no-color',
    '--no-renames',
    '--reverse',
    '--format=COMMIT %H',
    `${oldBase}..${oldTip}`
  )
)

const newAddedAnywhere = new Set()
for (const lines of (newStack ?? new Map()).values()) {
  for (const l of lines) {
    newAddedAnywhere.add(l)
  }
}

const fileCache = new Map()
function fileAt(rev, file) {
  const key = `${rev}:${file}`
  if (!fileCache.has(key)) {
    let text = ''
    try {
      text = execFileSync('git', ['show', key], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        maxBuffer: 1024 * 1024 * 1024
      })
    } catch {}
    const lines = new Set(text.split('\n').map((l) => l.trim()))
    fileCache.set(key, { lines, compact: compact(text) })
  }
  return fileCache.get(key)
}

// Why: upstream's formatter re-wraps lines; compare with whitespace and trailing , ; dropped.
const compact = (text) => text.replace(/\s+/g, '')
const compactLine = (line) => compact(line).replace(/[,;]+$/, '')
const newStackFiles = [...(newStack ?? new Map()).keys()]
const keptSomewhere = (file, line) => {
  const c = compactLine(line)
  if (fileAt(newTip, file).compact.includes(c)) {
    return true
  }
  return newStackFiles.some((f) => f !== file && fileAt(newTip, f).compact.includes(c))
}

const meta = new Map()
for (const sha of oldCommits.keys()) {
  const [subject, feature] = git(
    'log',
    '-1',
    '--format=%s%x00%(trailers:key=Custom-Feature,valueonly,separator=%x2C)',
    sha
  )
    .trim()
    .split('\0')
  meta.set(sha, { subject, feature: feature || '(no Custom-Feature)' })
}

// The commit that last added a line to a file in the old stack owns it.
function ownerOf(file, line) {
  let owner = null
  for (const [sha, files] of oldCommits) {
    if (files.get(file)?.has(line)) {
      owner = sha
    }
  }
  return owner
}

const lost = new Map() // sha -> [{file, line}]
for (const [file, lines] of oldStack ?? new Map()) {
  const now = fileAt(newTip, file).lines
  for (const line of lines) {
    if (now.has(line) || newAddedAnywhere.has(line) || keptSomewhere(file, line)) {
      continue
    }
    const sha = ownerOf(file, line) ?? '(unknown)'
    if (!lost.has(sha)) {
      lost.set(sha, [])
    }
    lost.get(sha).push({ file, line })
  }
}

const newSubjects = new Set(git('log', '--format=%s', `${newBase}..${newTip}`).split('\n'))
const vanished = [...meta.entries()].filter(([, m]) => !newSubjects.has(m.subject))

const out = []
out.push(`# sync guard ${oldTip.slice(0, 10)} → ${newTip.slice(0, 10)}`)
if (vanished.length) {
  out.push('', '## Commits gone from the stack (merged upstream, or dropped?)')
  for (const [sha, m] of vanished) {
    out.push(`- ${sha.slice(0, 10)} [${m.feature}] ${m.subject}`)
  }
}
let total = 0
if (lost.size) {
  out.push('', '## Lines our stack added that the new tip no longer has')
  for (const [sha, items] of lost) {
    total += items.length
    const m = meta.get(sha) ?? { feature: '?', subject: '?' }
    out.push('', `### ${sha.slice(0, 10)} [${m.feature}] ${m.subject} — ${items.length}`)
    for (const { file, line } of items.slice(0, 40)) {
      out.push(`- ${file}: \`${line.slice(0, 160)}\``)
    }
    if (items.length > 40) {
      out.push(`- … ${items.length - 40} more`)
    }
  }
}
out.push(
  '',
  vanished.length || total
    ? `## Explain or restore: ${total} lines, ${vanished.length} commits`
    : '## OK — nothing of ours is missing'
)
console.log(out.join('\n'))
process.exit(vanished.length || total ? 1 : 0)
