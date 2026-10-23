// Custom build (hq-plus-ui): the two numbers on HQ+'s left that the journal does not hold — how much the
// owner still routed by hand today (17.11's counter) and how far the plan named in HQ/hq-plus.yaml is.
import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { HqPlusFileStats } from '../../shared/hq-plus-screen'

const MANUAL_CACHE_MS = 15 * 60_000
const MANUAL_TIMEOUT_MS = 90_000
export const HQ_PLUS_CONFIG_FILE = 'hq-plus.yaml'
const BASELINE_FILE = 'journal/manual-routing-baseline.json'

export type HqPlusStatsDeps = {
  hqPath: () => string | null
  /** The counter script, or null when this install has none. */
  script: () => string | null
  /** Runs `python3 <script> <args>` and gives back its stdout. */
  run: (script: string, args: string[], env: NodeJS.ProcessEnv) => Promise<string>
  now: () => number
}

/** `plan: plans/x.md` and `section: Stage 17` — a flat two-key file, read by line. */
export function parseHqPlusConfig(text: string): { plan: string | null; section: string | null } {
  const value = (key: string): string | null => {
    const match = new RegExp(`^${key}:\\s*["']?([^"'#\\n]+?)["']?\\s*(?:#.*)?$`, 'm').exec(text)
    return match ? match[1].trim() : null
  }
  return { plan: value('plan'), section: value('section') }
}

/** Checked and open `- [ ]` steps under the section's heading, and the first open one. */
export function countHqPlanSteps(
  markdown: string,
  section: string | null
): { done: number; total: number; next: string | null } | null {
  const lines = markdown.split('\n')
  let inside = section === null
  let level = 0
  let done = 0
  let total = 0
  let next: string | null = null
  for (const line of lines) {
    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading && section !== null) {
      if (inside && heading[1].length <= level) {
        break
      }
      if (!inside && heading[2].includes(section)) {
        inside = true
        level = heading[1].length
      }
      continue
    }
    const step = inside ? /^- \[( |x|X)\]\s+(.*)$/.exec(line) : null
    if (!step) {
      continue
    }
    total += 1
    if (step[1] === ' ') {
      next ??= step[2]
        .replace(/\*\*/g, '')
        .split(/[.:]\s/)[0]
        .trim()
        .slice(0, 80)
    } else {
      done += 1
    }
  }
  return total > 0 ? { done, total, next } : null
}

function localDay(now: number): string {
  const day = new Date(now)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`
}

export function createHqPlusStats(deps: HqPlusStatsDeps): {
  read: () => Promise<HqPlusFileStats>
} {
  let manual: { at: number; day: string; today: number } | null = null
  let pending: Promise<void> | null = null

  const countToday = async (hq: string): Promise<void> => {
    const script = deps.script()
    if (!script) {
      return
    }
    const day = localDay(deps.now())
    const out = await deps.run(script, ['--since', day], { ...process.env, HQ_DIR: hq })
    const parsed: unknown = JSON.parse(out)
    const total =
      parsed && typeof parsed === 'object' ? Reflect.get(parsed, 'manual_total') : undefined
    if (typeof total === 'number') {
      manual = { at: deps.now(), day, today: total }
    }
  }

  return {
    async read() {
      const hq = deps.hqPath()
      if (!hq) {
        return { plan: null, manual: null }
      }
      const fresh =
        manual && manual.day === localDay(deps.now()) && deps.now() - manual.at < MANUAL_CACHE_MS
      if (!fresh && !pending) {
        // Why: the count reads a day of transcripts; the screen shows the last one while it runs.
        pending = countToday(hq)
          .catch((error: unknown) =>
            console.warn(
              '[hq-plus] manual count failed:',
              error instanceof Error ? error.message : error
            )
          )
          .finally(() => {
            pending = null
          })
      }
      const config = parseHqPlusConfig(
        await readFile(join(hq, HQ_PLUS_CONFIG_FILE), 'utf8').catch(() => '')
      )
      const plan = config.plan
        ? countHqPlanSteps(
            await readFile(join(hq, config.plan), 'utf8').catch(() => ''),
            config.section
          )
        : null
      const baseline: unknown = JSON.parse(
        await readFile(join(hq, BASELINE_FILE), 'utf8').catch(() => 'null')
      )
      const perDay =
        baseline && typeof baseline === 'object' ? Reflect.get(baseline, 'per_day') : undefined
      return {
        plan,
        manual:
          manual && manual.day === localDay(deps.now())
            ? { today: manual.today, perDay: typeof perDay === 'number' ? perDay : null }
            : null
      }
    }
  }
}

export function runPython(script: string, args: string[], env: NodeJS.ProcessEnv): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      process.platform === 'win32' ? 'python' : 'python3',
      ['-I', script, ...args],
      { env, timeout: MANUAL_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024, windowsHide: true },
      (error, stdout) => (error ? reject(error) : resolve(stdout))
    )
  })
}

let provided: { read: () => Promise<HqPlusFileStats> } | null = null

export function provideHqPlusStats(stats: { read: () => Promise<HqPlusFileStats> } | null): void {
  provided = stats
}

export function getHqPlusStats(): { read: () => Promise<HqPlusFileStats> } | null {
  return provided
}
