// Custom build (orca-plus-version): the version a packaged Orca+ reports in About and to its CLI.
// Upstream main never bumps package.json (release tags live on release branches), so every build
// from it read 1.4.197. The base comes from the same tag rule upstream's hourly builds use.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { resolveDevChannelBaseVersion } from './dev-channel-base-version.mjs'

/** `1.4.212-plus.202609251930`: after the newest shipped upstream release, below the next one. */
export function createOrcaPlusBuildVersion(packageVersion, tags, date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new Error('Orca+ build timestamp is invalid.')
  }
  const base = resolveDevChannelBaseVersion(packageVersion, tags)
  const pad = (value, width = 2) => String(value).padStart(width, '0')
  const stamp = [
    pad(date.getUTCFullYear(), 4),
    pad(date.getUTCMonth() + 1),
    pad(date.getUTCDate()),
    pad(date.getUTCHours()),
    pad(date.getUTCMinutes())
  ].join('')
  return `${base}-plus.${stamp}`
}

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', timeout: 20_000 })
}

/** Release tags known locally plus, when reachable, the ones upstream published since. */
export function readUpstreamReleaseTags(remote = 'upstream') {
  const tags = new Set(git(['tag', '--list', 'v*']).split('\n').filter(Boolean))
  try {
    for (const line of git(['ls-remote', '--tags', '--refs', remote, 'refs/tags/v*']).split('\n')) {
      const ref = line.split('\t')[1]
      if (ref) {
        tags.add(ref.replace('refs/tags/', ''))
      }
    }
  } catch {
    // Offline: local tags still give a floor; a stale base only understates the version.
  }
  return [...tags]
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const packageJson = JSON.parse(readFileSync(resolve('package.json'), 'utf8'))
  process.stdout.write(
    `${createOrcaPlusBuildVersion(packageJson.version, readUpstreamReleaseTags(), new Date())}\n`
  )
}
