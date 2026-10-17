// Custom build (hq-promises): takes the owner's promises the Slack scout found into the pulse as
// «waiting on me» — once each, matched to an existing person — and closes those he said he kept.
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  HQ_PROMISES_FILE,
  HQ_PROMISE_SOURCE,
  hqPromiseDueAt,
  parseHqScoutPromises,
  type HqScoutPromise
} from '../../shared/hq-promises'
import { HQ_SLACK_SCOUT_DIR } from '../../shared/hq-slack-scout'
import type {
  PulsePerson,
  PulsePersonInput,
  PulseWaiting,
  PulseWaitingInput
} from '../../shared/pulse-types'
import { createDebouncedSingleFlight } from '../orca-plus/debounced-single-flight'

// Why: the scout writes every 15 minutes; a few minutes' delay on a promise is fine.
const REFRESH_MS = 3 * 60_000

export type HqScoutPromisesDeps = {
  hqPath: () => string | null
  /** Every waiting, closed ones too, so a dropped promise is not recorded again. */
  listWaitings: () => PulseWaiting[]
  listPeople: () => PulsePerson[]
  upsertPerson: (input: PulsePersonInput) => PulsePerson
  addWaiting: (input: PulseWaitingInput) => PulseWaiting
  closeWaiting: (id: string, resolution: string) => void
}

/** By Slack id first, then by name. The scout's Slack id only looks people up, never binds one: it
 *  comes from a model reading other people's messages. */
function personFor(promise: HqScoutPromise, deps: HqScoutPromisesDeps): string {
  const people = deps.listPeople()
  const bySlack = promise.personSlackId
    ? people.find((person) => person.slackUserId === promise.personSlackId)
    : undefined
  if (bySlack) {
    return bySlack.id
  }
  const name = promise.person.toLocaleLowerCase()
  const byName = people.find((person) => person.name.toLocaleLowerCase() === name)
  if (byName) {
    return byName.id
  }
  return deps.upsertPerson({ name: promise.person }).id
}

export async function importHqScoutPromises(deps: HqScoutPromisesDeps): Promise<void> {
  const hq = deps.hqPath()
  if (!hq) {
    return
  }
  let raw: string
  try {
    raw = await readFile(join(hq, HQ_SLACK_SCOUT_DIR, HQ_PROMISES_FILE), 'utf8')
  } catch (error) {
    if (error instanceof Error && Reflect.get(error, 'code') === 'ENOENT') {
      return
    }
    throw error
  }
  const { promises, done } = parseHqScoutPromises(raw)
  const waitings = deps.listWaitings()
  const known = new Set(waitings.map((waiting) => waiting.sourceRef).filter(Boolean))
  for (const promise of promises) {
    if (known.has(promise.permalink)) {
      continue
    }
    deps.addWaiting({
      direction: 'on-me',
      title: promise.what,
      personId: personFor(promise, deps),
      source: HQ_PROMISE_SOURCE,
      sourceRef: promise.permalink,
      dueAt: hqPromiseDueAt(promise.due)
    })
    known.add(promise.permalink)
  }
  for (const kept of done) {
    // Why: only a promise the scout recorded may be closed by it, never a question we wait on.
    const open = waitings.find(
      (waiting) =>
        waiting.status === 'open' &&
        waiting.direction === 'on-me' &&
        waiting.source === HQ_PROMISE_SOURCE &&
        waiting.sourceRef === kept.permalink
    )
    if (open) {
      deps.closeWaiting(open.id, kept.reason)
    }
  }
}

export function startHqScoutPromises(deps: HqScoutPromisesDeps): () => void {
  const flight = createDebouncedSingleFlight(
    () => importHqScoutPromises(deps),
    (error) => console.warn('[hq-promises] import failed:', error),
    0
  )
  const timer = setInterval(() => void flight.runNow(), REFRESH_MS)
  timer.unref?.()
  flight.schedule()
  return () => {
    clearInterval(timer)
    flight.dispose()
  }
}
