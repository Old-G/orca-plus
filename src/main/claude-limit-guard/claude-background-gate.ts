// Custom build (claude-background-pause): the one gate background work asks before it starts. Scheduled
// automations, HQ's pollers that end in a model call and the launchd jobs (through the state file this
// gate writes) hold off while the selected Claude account has used 95% of its week; once the window's
// reset time passes, or a fresh reading is under the line, the next tick runs as usual.
import { appendFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type {
  InactiveAccountUsage,
  ProviderRateLimits
} from '../../shared/agent-usage/rate-limits/rate-limit-types'
import {
  claudeBackgroundPause,
  claudeSelectedAccountReading,
  describeClaudeBackgroundPause,
  type ClaudeBackgroundPause
} from '../../shared/claude-background-pause'

// Why: the usage service polls only while a window is watched; an evening job must not decide on a
// reading from the afternoon.
export const CLAUDE_BACKGROUND_READING_MAX_AGE_MS = 15 * 60_000
const READING_WAIT_MS = 20_000
const NO_RESET_PAUSE_MAX_AGE_MS = 6 * 60 * 60_000
export const CLAUDE_BACKGROUND_REFRESH_MS = 15 * 60_000

/** What the launchd jobs read: written whenever the answer changes and on every refresh. */
export type ClaudeBackgroundPauseFile = {
  paused: boolean
  weeklyPercent: number | null
  resumesAt: number | null
  accountId: string | null
  checkedAt: number
}

export type ClaudeBackgroundGateDeps = {
  reading: () => ProviderRateLimits | null
  inactive: () => readonly InactiveAccountUsage[]
  activeAccountId: () => string | null
  /** Starts a reading unless one that recent exists; returns whether it started one. */
  requestReading: (notWithinMs: number) => boolean
  onReadingChange: (listener: () => void) => () => void
  now: () => number
  statePath: string
  logPath: string
  /** Development builds only: a file standing in for the weekly window, for a live check. */
  testReadingPath?: string
  onChanged?: (pause: ClaudeBackgroundPause | null) => void
}

export type ClaudeBackgroundGate = {
  current: () => ClaudeBackgroundPause | null
  /** Re-reads the answer from the current reading, without asking for a new one. */
  evaluate: () => ClaudeBackgroundPause | null
  /** On the reading at hand — for pollers that tick every few minutes; the refresh keeps it recent. */
  allows: (job: string) => boolean
  /** After a fresh reading when the one at hand is old — for runs that come once a day. */
  admits: (job: string) => Promise<boolean>
  refresh: () => void
  /** One line in the gate's log, for what happens around a pause (a catch-up run). */
  note: (line: string) => void
}

type TestReading = { weeklyPercent: number; resetsAt: number | null }

function readTestReading(path: string | undefined): TestReading | null {
  if (!path) {
    return null
  }
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<TestReading>
    return typeof parsed.weeklyPercent === 'number'
      ? { weeklyPercent: parsed.weeklyPercent, resetsAt: parsed.resetsAt ?? null }
      : null
  } catch {
    return null
  }
}

function testProviderReading(test: TestReading, now: number): ProviderRateLimits {
  return {
    provider: 'claude',
    session: null,
    weekly: {
      usedPercent: test.weeklyPercent,
      windowMinutes: 10080,
      resetsAt: test.resetsAt,
      resetDescription: null
    },
    updatedAt: now,
    error: null,
    status: 'ok'
  }
}

function samePause(a: ClaudeBackgroundPause | null, b: ClaudeBackgroundPause | null): boolean {
  return (
    a === b ||
    (a !== null &&
      b !== null &&
      a.weeklyPercent === b.weeklyPercent &&
      a.resumesAt === b.resumesAt &&
      a.accountId === b.accountId)
  )
}

/** Waits for the reading that `startedAfter` predates — not the «fetching» update the request sends first. */
function waitForReading(
  deps: ClaudeBackgroundGateDeps,
  startedAfter: number | null
): Promise<void> {
  return new Promise((resolve) => {
    let release: () => void = () => {}
    const done = (): void => {
      clearTimeout(timer)
      release()
      resolve()
    }
    const timer = setTimeout(done, READING_WAIT_MS)
    release = deps.onReadingChange(() => {
      const reading = deps.reading()
      if (reading && reading.status !== 'fetching' && reading.updatedAt !== startedAfter) {
        done()
      }
    })
  })
}

function readPersistedPause(path: string): ClaudeBackgroundPauseFile | null {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as ClaudeBackgroundPauseFile
    return parsed.paused === true && typeof parsed.weeklyPercent === 'number' ? parsed : null
  } catch {
    return null
  }
}

/** Before the first reading after a restart, the pause the last run of the app wrote, while it holds. */
function persistedPause(
  file: ClaudeBackgroundPauseFile | null,
  activeAccountId: string | null,
  now: number
): ClaudeBackgroundPause | null {
  if (!file || file.weeklyPercent === null || file.accountId !== activeAccountId) {
    return null
  }
  const holds =
    file.resumesAt !== null
      ? file.resumesAt > now
      : now - file.checkedAt <= NO_RESET_PAUSE_MAX_AGE_MS
  return holds
    ? { weeklyPercent: file.weeklyPercent, resumesAt: file.resumesAt, accountId: file.accountId }
    : null
}

export function createClaudeBackgroundGate(deps: ClaudeBackgroundGateDeps): ClaudeBackgroundGate {
  let last: ClaudeBackgroundPause | null = null
  const persisted = readPersistedPause(deps.statePath)
  let lastWritten = ''
  // Jobs that were held back in the current pause, so each says once that it stopped and once that it ran again.
  const held = new Set<string>()

  const log = (line: string): void => {
    try {
      mkdirSync(dirname(deps.logPath), { recursive: true })
      appendFileSync(deps.logPath, `${new Date(deps.now()).toISOString()} ${line}\n`)
    } catch (error) {
      console.warn('[claude-background-pause] log write failed:', error)
    }
    console.log(`[claude-background-pause] ${line}`)
  }

  const writeState = (pause: ClaudeBackgroundPause | null): void => {
    const file: ClaudeBackgroundPauseFile = {
      paused: pause !== null,
      weeklyPercent: pause?.weeklyPercent ?? null,
      resumesAt: pause?.resumesAt ?? null,
      accountId: pause?.accountId ?? null,
      checkedAt: deps.now()
    }
    const body = `${JSON.stringify(file, null, 2)}\n`
    try {
      mkdirSync(dirname(deps.statePath), { recursive: true })
      const temp = `${deps.statePath}.tmp`
      writeFileSync(temp, body)
      renameSync(temp, deps.statePath)
      lastWritten = body
    } catch (error) {
      console.warn('[claude-background-pause] state write failed:', error)
    }
  }

  const evaluate = (): ClaudeBackgroundPause | null => {
    const now = deps.now()
    const test = readTestReading(deps.testReadingPath)
    const reading = test ? testProviderReading(test, now) : deps.reading()
    const activeAccountId = deps.activeAccountId()
    const live = claudeBackgroundPause({
      reading,
      inactive: test ? [] : deps.inactive(),
      activeAccountId,
      now
    })
    const pause = reading ? live : (live ?? persistedPause(persisted, activeAccountId, now))
    const changed = !samePause(pause, last)
    if (changed) {
      log(
        pause
          ? describeClaudeBackgroundPause(pause)
          : 'background on: weekly limit under 95% or reset'
      )
      last = pause
    }
    // Why: the file first — a launchd job started on the change must read the new answer.
    if (changed || lastWritten === '') {
      writeState(pause)
    }
    if (changed) {
      deps.onChanged?.(pause)
    }
    return pause
  }

  /** The selected account's reading time, or null when there is none. */
  const selectedReadingAt = (): number | null =>
    claudeSelectedAccountReading({
      reading: deps.reading(),
      inactive: deps.inactive(),
      activeAccountId: deps.activeAccountId()
    })?.updatedAt ?? null

  const allows = (job: string): boolean => {
    const pause = evaluate()
    if (pause) {
      if (!held.has(job)) {
        held.add(job)
        log(`skip ${job}: ${describeClaudeBackgroundPause(pause)}`)
      }
      return false
    }
    if (held.delete(job)) {
      log(`run ${job}: background on again`)
    }
    return true
  }

  return {
    current: () => last,
    evaluate,
    note: log,
    allows,
    admits: async (job) => {
      const readAt = selectedReadingAt()
      const stale = readAt === null || deps.now() - readAt > CLAUDE_BACKGROUND_READING_MAX_AGE_MS
      // Why: a request refused (a fetch already running, Retry-After) decides on the reading at hand —
      // the reset time still ends an old pause, so this can only let one run through, never hold one.
      if (
        !readTestReading(deps.testReadingPath) &&
        stale &&
        deps.requestReading(CLAUDE_BACKGROUND_READING_MAX_AGE_MS)
      ) {
        await waitForReading(deps, deps.reading()?.updatedAt ?? null)
      }
      return allows(job)
    },
    refresh: () => {
      if (!readTestReading(deps.testReadingPath)) {
        deps.requestReading(CLAUDE_BACKGROUND_READING_MAX_AGE_MS)
      }
      evaluate()
      // Why: the launchd jobs trust a no-reset pause only while it is recent; keep its time current.
      writeState(last)
    }
  }
}

let provided: ClaudeBackgroundGate | null = null

export function provideClaudeBackgroundGate(gate: ClaudeBackgroundGate | null): void {
  provided = gate
}

export function claudeBackgroundPauseNow(): ClaudeBackgroundPause | null {
  return provided?.current() ?? null
}

/**
 * Whether background work named `job` may start now. Before the gate is set up (tests, early startup)
 * everything may run: an unknown limit never stops work.
 */
export async function claudeBackgroundAdmits(job: string): Promise<boolean> {
  if (!provided) {
    return true
  }
  try {
    return await provided.admits(job)
  } catch (error) {
    console.warn('[claude-background-pause] gate failed, letting the job run:', error)
    return true
  }
}

/** A line in the gate's log; nothing before the gate is set up. */
export function claudeBackgroundNote(line: string): void {
  provided?.note(line)
}

/** The same answer without waiting for a reading: HQ's pollers ask this on every tick. */
export function claudeBackgroundAllows(job: string): boolean {
  if (!provided) {
    return true
  }
  try {
    return provided.allows(job)
  } catch (error) {
    console.warn('[claude-background-pause] gate failed, letting the job run:', error)
    return true
  }
}
