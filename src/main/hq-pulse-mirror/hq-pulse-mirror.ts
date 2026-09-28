// Custom build (hq-pulse-mirror): pulse decisions and people reach HQ as Markdown, so an agent
// answering in HQ reads them like any other page. Committed only when HQ was clean before.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PulseDecision, PulsePerson } from '../../shared/pulse-types'
import type { HqCommandResult } from '../hq-roster-sync/hq-roster-sync'
import { createDebouncedSingleFlight } from '../orca-plus/debounced-single-flight'
import type { PulseDb } from '../orca-plus/pulse/pulse-db'
import {
  DECISION_ID_KEY,
  localDay,
  newPersonPage,
  PERSON_ID_KEY,
  pageSlug,
  readFrontValue,
  renderDecisionPage,
  renderPersonBlock,
  replacePersonBlock,
  type PageLink
} from './hq-pulse-pages'

export type HqPulseMirrorOutcome =
  | 'off'
  | 'no-db'
  | 'unchanged'
  | 'committed'
  | 'left-uncommitted'
  | 'failed'

export type HqPulseMirrorDeps = {
  hqPath: () => string | null
  /** The pulse database, or null while it does not exist yet. */
  openDb: () => PulseDb | null
  git: (args: readonly string[], cwd: string) => Promise<HqCommandResult>
  log: (message: string) => void
  debounceMs?: number
}

const DEFAULT_DEBOUNCE_MS = 3_000
const MAX_DECISIONS = 1_000

/** HQ-relative path per person: the page that names them, else a fresh slug nobody holds. */
function personPaths(hq: string, people: PulsePerson[]): Map<string, string> {
  const dir = join(hq, 'people')
  const taken = new Map<string, string | null>()
  for (const file of readdirSync(dir).filter((name) => name.endsWith('.md'))) {
    taken.set(file, readFrontValue(readFileSync(join(dir, file), 'utf8'), PERSON_ID_KEY))
  }
  const byId = new Map<string, string>()
  for (const [file, id] of taken) {
    if (id) {
      byId.set(id, `people/${file}`)
    }
  }
  for (const person of people) {
    if (byId.has(person.id)) {
      continue
    }
    const base = pageSlug(person.name, 'person')
    const file = taken.has(`${base}.md`) ? `${base}-${person.id.slice(0, 8)}.md` : `${base}.md`
    taken.set(file, person.id)
    byId.set(person.id, `people/${file}`)
  }
  return byId
}

function freeDecisionPath(hq: string, decision: PulseDecision): string {
  const base = `${localDay(decision.decidedAt)}-${pageSlug(decision.title, 'decision')}`
  let name = `${base}.md`
  for (let n = 2; existsSync(join(hq, 'decisions', name)); n += 1) {
    name = `${base}-${n}.md`
  }
  return `decisions/${name}`
}

// Why: pages sit one level below HQ, so links between them go through `..`.
const fromPage = (hqRelative: string): string => `../${hqRelative}`

/** Decision id → HQ-relative path of the page already written for it. */
function writtenDecisions(hq: string): Map<string, string> {
  const dir = join(hq, 'decisions')
  const found = new Map<string, string>()
  for (const file of readdirSync(dir).filter((name) => name.endsWith('.md'))) {
    const id = readFrontValue(readFileSync(join(dir, file), 'utf8'), DECISION_ID_KEY)
    if (id) {
      found.set(id, `decisions/${file}`)
    }
  }
  return found
}

function writeDecisions(
  hq: string,
  db: PulseDb,
  people: PulsePerson[],
  paths: Map<string, string>
) {
  const names = new Map(people.map((person) => [person.id, person.name]))
  const written: string[] = []
  const pending = db.listDecisions({ unmirrored: true, kind: 'decision', limit: MAX_DECISIONS })
  const existing = pending.length > 0 ? writtenDecisions(hq) : new Map<string, string>()
  for (const decision of pending.toReversed()) {
    // Why: a page written before a crash that skipped the DB mark is adopted, not duplicated.
    const already = existing.get(decision.id)
    if (already) {
      db.setDecisionMirror(decision.id, already)
      continue
    }
    const rel = freeDecisionPath(hq, decision)
    const personPath = decision.personId ? paths.get(decision.personId) : undefined
    const person: PageLink | null =
      decision.personId && personPath
        ? { title: names.get(decision.personId) ?? 'person', path: fromPage(personPath) }
        : null
    const projectRel = decision.project ? `projects/${decision.project}.md` : null
    const projectPage = projectRel && existsSync(join(hq, projectRel)) ? fromPage(projectRel) : null
    writeFileSync(join(hq, rel), renderDecisionPage(decision, person, projectPage), { flag: 'wx' })
    db.setDecisionMirror(decision.id, rel)
    written.push(rel)
  }
  return written
}

function writePeople(
  hq: string,
  db: PulseDb,
  people: PulsePerson[],
  paths: Map<string, string>,
  log: (message: string) => void
): string[] {
  const byPerson = new Map<string, PageLink[]>()
  for (const decision of db.listDecisions({ kind: 'decision', limit: MAX_DECISIONS })) {
    if (decision.personId && decision.mirroredPath) {
      const links = byPerson.get(decision.personId) ?? []
      links.push({
        title: `${localDay(decision.decidedAt)} ${decision.title}`,
        path: fromPage(decision.mirroredPath)
      })
      byPerson.set(decision.personId, links)
    }
  }
  const written: string[] = []
  for (const person of people) {
    const rel = paths.get(person.id)
    if (!rel) {
      continue
    }
    const file = join(hq, rel)
    const block = renderPersonBlock(person, byPerson.get(person.id) ?? [])
    const old = existsSync(file) ? readFileSync(file, 'utf8') : null
    const next = old === null ? newPersonPage(person, block) : replacePersonBlock(old, block)
    if (next === null) {
      log(`${rel} has no orca-pulse markers; left as is`)
      continue
    }
    if (next !== old) {
      writeFileSync(file, next)
      written.push(rel)
    }
  }
  return written
}

export function createHqPulseMirror(deps: HqPulseMirrorDeps) {
  const runOnce = async (): Promise<HqPulseMirrorOutcome> => {
    const hq = deps.hqPath()?.trim()
    if (!hq || !existsSync(hq)) {
      return 'off'
    }
    const db = deps.openDb()
    if (!db) {
      return 'no-db'
    }
    // Why: commit only when HQ was clean, so the commit never sweeps up the owner's own edits.
    const status = await deps.git(['status', '--porcelain'], hq)
    const committable = status.code === 0 && status.stdout.trim() === ''
    mkdirSync(join(hq, 'decisions'), { recursive: true })
    mkdirSync(join(hq, 'people'), { recursive: true })
    const people = db.listPeople()
    const paths = personPaths(hq, people)
    const decisions = writeDecisions(hq, db, people, paths)
    const pages = writePeople(hq, db, people, paths, deps.log)
    if (decisions.length === 0 && pages.length === 0) {
      return 'unchanged'
    }
    if (!committable) {
      deps.log('HQ had uncommitted changes; pulse pages written but not committed')
      return 'left-uncommitted'
    }
    const message = `chore(pulse): decisions +${decisions.length}, people ${pages.length}`
    const add = await deps.git(['add', '--', ...decisions, ...pages], hq)
    const commit = add.code === 0 ? await deps.git(['commit', '-q', '-m', message], hq) : add
    if (commit.code !== 0) {
      deps.log(`HQ commit failed: ${commit.stderr.trim()}`)
      return 'left-uncommitted'
    }
    deps.log(message)
    return 'committed'
  }

  return createDebouncedSingleFlight<HqPulseMirrorOutcome>(
    runOnce,
    (error) => {
      deps.log(`mirror failed: ${String(error)}`)
      return 'failed'
    },
    deps.debounceMs ?? DEFAULT_DEBOUNCE_MS
  )
}
