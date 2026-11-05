// Custom build (hq-plus-brain): the host side of HQ+'s «Brain» screen. Runs HQ's own brain script
// (`<HQ>/scripts/hq_brain.py timeline|search --json`, the path from Orca+'s settings) and adds what only
// Pulse knows: an approval's outcome and where it went, a wait's state and person, the chat a row was
// said in. No search of its own — the index is HQ's.
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  hqBrainModeOf,
  readHqBrainSearch,
  readHqBrainTimeline,
  type HqBrainResult,
  type HqBrainScriptRow
} from '../../shared/hq-brain'
import {
  enrichHqBrainRow,
  hqBrainHead,
  hqBrainOpenWaits,
  hqBrainPeople,
  pulseIndex,
  type HqBrainPulse
} from './hq-brain-rows'

export const HQ_BRAIN_SCRIPT = ['scripts', 'hq_brain.py'] as const
const TIMELINE_LIMIT = 150
const SEARCH_LIMIT = 40
const RUN_TIMEOUT_MS = 30_000
const CACHE_MS = 60_000
const CACHE_SIZE = 20

export type HqBrainDeps = {
  hqPath: () => string | null
  /** Runs `python3 <script> <args>` and gives back its stdout. */
  run: (script: string, args: string[]) => Promise<string>
  pulse: HqBrainPulse
  /** The workspace an Orca chat lives in, so «Open chat» can bring a closed one back. */
  sessionWorkspace: (sessionId: string) => string | null
  now: () => number
  exists?: (path: string) => boolean
}

export type HqBrainService = { look: (query: string) => Promise<HqBrainResult> }

export function runHqBrainPython(script: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      process.platform === 'win32' ? 'python' : 'python3',
      [script, ...args],
      { env: process.env, timeout: RUN_TIMEOUT_MS, maxBuffer: 32 * 1024 * 1024, windowsHide: true },
      (error, stdout, stderr) => {
        if (error) {
          const detail = String(stderr || '')
            .trim()
            .split('\n')
            .at(-1)
          reject(new Error(detail || error.message))
          return
        }
        resolve(stdout)
      }
    )
  })
}

export function createHqBrain(deps: HqBrainDeps): HqBrainService {
  const exists = deps.exists ?? existsSync
  const cache = new Map<string, { at: number; result: HqBrainResult }>()

  const look = async (query: string): Promise<HqBrainResult> => {
    const hq = deps.hqPath()
    if (!hq) {
      throw new Error('HQ is not set: choose its folder in Settings → HQ.')
    }
    const script = join(hq, ...HQ_BRAIN_SCRIPT)
    if (!exists(script)) {
      throw new Error(`HQ has no brain script: ${script}`)
    }
    const text = query.trim()
    let mode = hqBrainModeOf(text)
    let matchedBy: HqBrainResult['matchedBy'] = 'words'
    let ms = 0
    let found: HqBrainScriptRow[] = []
    const search = async (): Promise<void> => {
      const out = await deps.run(script, [
        '--hq',
        hq,
        'search',
        '--json',
        '--limit',
        String(SEARCH_LIMIT),
        // Why: «--» ends the options, so a query that starts with «-» stays the query.
        '--',
        text
      ])
      const parsed = readHqBrainSearch(JSON.parse(out))
      if (!parsed) {
        throw new Error('The brain search answered in an unknown shape.')
      }
      mode = 'search'
      matchedBy = 'words'
      ms = parsed.ms
      found = parsed.rows
    }
    if (mode === 'timeline') {
      const out = await deps.run(script, [
        '--hq',
        hq,
        'timeline',
        '--json',
        '--limit',
        String(TIMELINE_LIMIT),
        // Why: «--» ends the options, so a query that starts with «-» stays the query.
        '--',
        text
      ])
      const parsed = readHqBrainTimeline(JSON.parse(out))
      if (!parsed) {
        throw new Error('The brain timeline answered in an unknown shape.')
      }
      matchedBy = parsed.matchedBy
      ms = parsed.ms
      found = parsed.rows
      // Why: words no row holds all of may still be said together somewhere; the ranked search finds it.
      if (found.length === 0 && (matchedBy === 'words' || matchedBy === 'nothing')) {
        await search()
      }
    } else {
      await search()
    }
    const index = pulseIndex(deps.pulse)
    const rows = found.map((row) => enrichHqBrainRow(row, index, deps.sessionWorkspace))
    const waiting = hqBrainOpenWaits(text, matchedBy, rows, index, deps.sessionWorkspace)
    return {
      query: text,
      mode,
      matchedBy,
      ms,
      head:
        mode === 'search'
          ? { kind: 'words', title: null, link: null, project: null }
          : hqBrainHead(text, matchedBy, rows, deps.pulse.people()),
      rows,
      waiting,
      closedWaits: rows.filter((row) => row.status?.kind === 'wait' && row.status.status !== 'open')
        .length,
      people: hqBrainPeople(rows, waiting)
    }
  }

  return {
    async look(query) {
      const key = query.trim()
      if (!key) {
        throw new Error('Type a task, an MR, a person or a project.')
      }
      const hit = cache.get(key)
      if (hit && deps.now() - hit.at < CACHE_MS) {
        return hit.result
      }
      const result = await look(key)
      cache.delete(key)
      cache.set(key, { at: deps.now(), result })
      while (cache.size > CACHE_SIZE) {
        cache.delete(cache.keys().next().value as string)
      }
      return result
    }
  }
}

let provided: HqBrainService | null = null

export function provideHqBrain(service: HqBrainService | null): void {
  provided = service
}

export function getHqBrain(): HqBrainService | null {
  return provided
}
