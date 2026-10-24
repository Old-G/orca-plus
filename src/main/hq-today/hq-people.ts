// Custom build (hq-people): reads HQ's org matrix and person pages, builds the «People» list and a
// person's card from them and the pulse, and keeps pulse people's Slack/ClickUp ids and role filled.
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  HQ_EMPTY_DOSSIER,
  HQ_ORG_FILES,
  HQ_ORG_PERSON_KEY,
  HQ_PEOPLE_DIR,
  HQ_PULSE_ONLY_PREFIX,
  hqOrgRole,
  hqPersonPageNotes,
  matchHqOrgPerson,
  parseHqOrgCsv,
  type HqOrgPerson,
  type HqPeopleRow,
  type HqPersonCard,
  type HqPersonCardItem,
  type HqPersonPage
} from '../../shared/hq-people'
import type {
  PulseDecision,
  PulsePerson,
  PulsePersonInput,
  PulseWaiting
} from '../../shared/pulse-types'
import { PERSON_ID_KEY, readFrontValue } from '../hq-pulse-mirror/hq-pulse-pages'
import { readHqPersonDossier } from './hq-person-dossier'

const REFRESH_MS = 10 * 60_000
const CARD_SENT_MAX = 10

export type HqPeopleFiles = { org: HqOrgPerson[]; pages: (HqPersonPage & { markdown: string })[] }

export async function readHqPeopleFiles(hqPath: string): Promise<HqPeopleFiles> {
  const dir = join(hqPath, HQ_PEOPLE_DIR)
  const org: HqOrgPerson[] = []
  for (const file of HQ_ORG_FILES) {
    const text = await readFile(join(dir, file), 'utf8').catch(() => null)
    for (const row of text ? parseHqOrgCsv(text) : []) {
      // Why: org-extra.csv only adds people; a key the matrix already has stays the matrix's.
      if (!org.some((known) => known.key === row.key)) {
        org.push(row)
      }
    }
  }
  const names = await readdir(dir).catch(() => [])
  const pages = await Promise.all(
    names
      .filter((name) => name.endsWith('.md'))
      .map(async (name) => {
        const markdown = await readFile(join(dir, name), 'utf8')
        return {
          path: `${HQ_PEOPLE_DIR}/${name}`,
          pulsePersonId: readFrontValue(markdown, PERSON_ID_KEY),
          orgKey: readFrontValue(markdown, HQ_ORG_PERSON_KEY),
          notes: hqPersonPageNotes(markdown),
          dossier: readHqPersonDossier(markdown),
          markdown
        }
      })
  )
  return { org, pages }
}

type PeopleSources = {
  files: HqPeopleFiles
  people: PulsePerson[]
  /** Open waitings. */
  waitings: PulseWaiting[]
}

/** Org rows first (with the pulse person each one is), then people only pulse knows. */
export function buildHqPeopleRows({ files, people, waitings }: PeopleSources): HqPeopleRow[] {
  const pulseOf = new Map<string, PulsePerson>()
  const loose: PulsePerson[] = []
  for (const person of people) {
    const row = matchHqOrgPerson(person, files.org, files.pages)
    if (row && !pulseOf.has(row.key)) {
      pulseOf.set(row.key, person)
    } else {
      loose.push(person)
    }
  }
  const counts = (personId: string | null) => ({
    onMe: personId
      ? waitings.filter((w) => w.personId === personId && w.direction === 'on-me').length
      : 0,
    onThem: personId
      ? waitings.filter((w) => w.personId === personId && w.direction === 'on-them').length
      : 0
  })
  const pageOf = (pulseId: string | null, orgKey: string | null) =>
    files.pages.find(
      (page) =>
        (pulseId !== null && page.pulsePersonId === pulseId) ||
        (orgKey !== null && page.orgKey === orgKey)
    ) ?? null
  // Custom build (hq-closed-loop): the dossier on the page; its ids fill what the matrix lacks.
  const dossierOf = (page: HqPersonPage | null) => {
    const dossier = page?.dossier ?? HQ_EMPTY_DOSSIER
    return {
      fields: {
        aliases: dossier.aliases,
        projects: dossier.projects,
        decides: dossier.decides,
        channel: dossier.channel,
        timezone: dossier.timezone
      },
      dossier
    }
  }
  const orgRows = files.org.map((row): HqPeopleRow => {
    const person = pulseOf.get(row.key) ?? null
    const page = pageOf(person?.id ?? null, row.key)
    const { fields, dossier } = dossierOf(page)
    return {
      key: row.key,
      name: person?.name ?? row.name,
      orgName: row.name,
      jobTitle: row.jobTitle,
      department: row.department,
      location: row.location,
      supervisorKey: row.supervisorKey,
      slackUserId: row.slackUserId ?? person?.slackUserId ?? dossier.slackUserId,
      clickupUserId: row.clickupUserId ?? person?.clickupUserId ?? dossier.clickupUserId,
      email: row.email ?? dossier.email,
      slackHandle: row.slackHandle ?? dossier.slackHandle,
      pulsePersonId: person?.id ?? null,
      pagePath: page?.path ?? null,
      ...counts(person?.id ?? null),
      ...fields
    }
  })
  const looseRows = loose.map((person): HqPeopleRow => {
    const page = pageOf(person.id, null)
    const { fields, dossier } = dossierOf(page)
    return {
      key: `${HQ_PULSE_ONLY_PREFIX}${person.id}`,
      name: person.name,
      orgName: null,
      jobTitle: person.role,
      department: null,
      location: null,
      supervisorKey: null,
      slackUserId: person.slackUserId ?? dossier.slackUserId,
      clickupUserId: person.clickupUserId ?? dossier.clickupUserId,
      email: dossier.email,
      slackHandle: dossier.slackHandle,
      pulsePersonId: person.id,
      pagePath: page?.path ?? null,
      ...counts(person.id),
      ...fields
    }
  })
  return [...orgRows, ...looseRows]
}

const item = (id: string, title: string, at: number, project: string | null): HqPersonCardItem => ({
  id,
  title,
  at,
  project
})

/** Whether an approval went to this person: their pulse id, Slack id, or a DM named after them. */
function sentTo(decision: PulseDecision, row: HqPeopleRow): boolean {
  if (row.pulsePersonId && decision.personId === row.pulsePersonId) {
    return true
  }
  const sent = decision.sentContext
  if (!sent) {
    return false
  }
  if (row.slackUserId && sent.targetId === row.slackUserId) {
    return true
  }
  const target = sent.targetName?.toLocaleLowerCase() ?? ''
  return [row.name, row.orgName]
    .filter((name): name is string => Boolean(name))
    .some((name) => target === `dm with ${name.toLocaleLowerCase()}`)
}

export function buildHqPersonCard(
  row: HqPeopleRow,
  sources: PeopleSources & { decisions: PulseDecision[] }
): HqPersonCard {
  const page = sources.files.pages.find((entry) => entry.path === row.pagePath) ?? null
  const mine = sources.waitings.filter(
    (waiting) => row.pulsePersonId !== null && waiting.personId === row.pulsePersonId
  )
  const waitingItem = (waiting: PulseWaiting) =>
    item(waiting.id, waiting.title, waiting.createdAt, waiting.project)
  return {
    notes: page?.notes ?? null,
    onMe: mine.filter((waiting) => waiting.direction === 'on-me').map(waitingItem),
    onThem: mine.filter((waiting) => waiting.direction === 'on-them').map(waitingItem),
    sent: sources.decisions
      .filter((decision) => decision.kind === 'approval' && decision.outcome !== 'rejected')
      .filter((decision) => sentTo(decision, row))
      .slice(0, CARD_SENT_MAX)
      .map((decision) => item(decision.id, decision.title, decision.decidedAt, decision.project))
  }
}

/** What pulse should learn from the matrix: missing ids and the current role, nothing else. */
export function planHqPeopleSync(
  people: readonly PulsePerson[],
  files: Pick<HqPeopleFiles, 'org' | 'pages'>
): PulsePersonInput[] {
  const heldSlack = new Set(people.map((person) => person.slackUserId).filter(Boolean))
  const heldClickUp = new Set(people.map((person) => person.clickupUserId).filter(Boolean))
  const updates: PulsePersonInput[] = []
  for (const person of people) {
    const row = matchHqOrgPerson(person, files.org, files.pages)
    if (!row) {
      continue
    }
    // Why: the ids are unique in pulse; one another person already holds is left for the owner to merge.
    const slackUserId =
      person.slackUserId ??
      (row.slackUserId && !heldSlack.has(row.slackUserId) ? row.slackUserId : null)
    const clickupUserId =
      person.clickupUserId ??
      (row.clickupUserId && !heldClickUp.has(row.clickupUserId) ? row.clickupUserId : null)
    const role = hqOrgRole(row) ?? person.role
    if (
      slackUserId === person.slackUserId &&
      clickupUserId === person.clickupUserId &&
      role === person.role
    ) {
      continue
    }
    if (slackUserId) {
      heldSlack.add(slackUserId)
    }
    if (clickupUserId) {
      heldClickUp.add(clickupUserId)
    }
    updates.push({ id: person.id, name: person.name, slackUserId, clickupUserId, role })
  }
  return updates
}

export type HqPeopleSyncDeps = {
  hqPath: () => string | null
  listPeople: () => PulsePerson[]
  upsertPerson: (input: PulsePersonInput) => PulsePerson
}

export function startHqPeopleSync(deps: HqPeopleSyncDeps): () => void {
  const run = async (): Promise<void> => {
    const hqPath = deps.hqPath()
    if (!hqPath) {
      return
    }
    const files = await readHqPeopleFiles(hqPath)
    if (files.org.length === 0) {
      return
    }
    for (const update of planHqPeopleSync(deps.listPeople(), files)) {
      deps.upsertPerson(update)
      console.info(`[hq-people] ${update.name}: ids and role from the org matrix`)
    }
  }
  const tick = (): void =>
    void run().catch((error: unknown) =>
      console.warn('[hq-people] sync failed:', error instanceof Error ? error.message : error)
    )
  tick()
  const timer = setInterval(tick, REFRESH_MS)
  timer.unref?.()
  return () => clearInterval(timer)
}
