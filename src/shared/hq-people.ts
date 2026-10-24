// Custom build (hq-people): HQ's «People» — the company's org matrix (`people/org.csv`, plus
// `people/org-extra.csv` for anyone it misses) joined with the owner's own pages and pulse records.
import { z } from 'zod'

export const HQ_PEOPLE_DIR = 'people'
export const HQ_ORG_FILES = ['org.csv', 'org-extra.csv'] as const
/** Front-matter key on a person page that names its org row. */
export const HQ_ORG_PERSON_KEY = 'org_person_id'
/** Key of someone known only to pulse, not to the org matrix. */
export const HQ_PULSE_ONLY_PREFIX = 'pulse:'

export type HqOrgPerson = {
  key: string
  name: string
  jobTitle: string | null
  department: string | null
  location: string | null
  supervisorKey: string | null
  slackUserId: string | null
  clickupUserId: string | null
  /** Custom build (hq-closed-loop): where to write them, and the @name they go by in Slack. */
  email: string | null
  slackHandle: string | null
}

/** Custom build (hq-closed-loop): a person's dossier — the front matter of their page under `people/`,
 *  written by hand or by the people interview. Any field may be missing. */
export type HqPersonDossier = {
  aliases: string[]
  projects: { slug: string; role: string | null }[]
  /** What they decide themselves. */
  decides: string[]
  /** Where to write them: `default`, and per kind of message (`status`, `urgent`, …). */
  channel: Record<string, string>
  timezone: string | null
  slackUserId: string | null
  slackHandle: string | null
  email: string | null
  clickupUserId: string | null
}

export const HQ_EMPTY_DOSSIER: HqPersonDossier = {
  aliases: [],
  projects: [],
  decides: [],
  channel: {},
  timezone: null,
  slackUserId: null,
  slackHandle: null,
  email: null,
  clickupUserId: null
}

/** A person page under `people/`: whose it is, and the owner's notes on them. */
export type HqPersonPage = {
  path: string
  pulsePersonId: string | null
  orgKey: string | null
  notes: string | null
  dossier?: HqPersonDossier
}

/** Splits one CSV line set into rows; quoted fields may hold commas, quotes and newlines. */
function csvRows(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        cell += '"'
        i += 1
      } else if (char === '"') {
        quoted = false
      } else {
        cell += char
      }
    } else if (char === '"') {
      quoted = true
    } else if (char === ',') {
      row.push(cell)
      cell = ''
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') {
        i += 1
      }
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else {
      cell += char
    }
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell)
    rows.push(row)
  }
  return rows.filter((entry) => entry.some((value) => value.trim() !== ''))
}

const orNull = (value: string | undefined): string | null => value?.trim() || null

/** Rows of an org CSV whose header names `person_id` and `name`; others are skipped. */
export function parseHqOrgCsv(text: string): HqOrgPerson[] {
  const [header, ...rows] = csvRows(text.replace(/^\uFEFF/, ''))
  if (!header) {
    return []
  }
  const col = (name: string): number => header.findIndex((entry) => entry.trim() === name)
  const at = (row: string[], name: string): string | null => {
    const index = col(name)
    return index < 0 ? null : orNull(row[index])
  }
  return rows.flatMap((row) => {
    const key = at(row, 'person_id')
    const name = at(row, 'name')
    if (!key || !name) {
      return []
    }
    return [
      {
        key,
        name,
        jobTitle: at(row, 'job_title'),
        department: at(row, 'department'),
        location: at(row, 'location'),
        supervisorKey: at(row, 'supervisor_id'),
        slackUserId: at(row, 'slack_user_id'),
        clickupUserId: at(row, 'clickup_user_id'),
        email: at(row, 'email'),
        slackHandle: at(row, 'slack_handle')
      }
    ]
  })
}

/** The `## Notes` section of a person page, without its HTML comments; null when empty. */
export function hqPersonPageNotes(markdown: string): string | null {
  const start = markdown.search(/^## Notes\s*$/m)
  if (start < 0) {
    return null
  }
  const rest = markdown.slice(start).replace(/^## Notes\s*$/m, '')
  const next = rest.search(/^## /m)
  const body = (next < 0 ? rest : rest.slice(0, next)).replace(/<!--[\s\S]*?-->/g, '').trim()
  return body || null
}

type PulseLike = {
  id: string
  name: string
  slackUserId: string | null
  clickupUserId: string | null
}

const sameName = (a: string, b: string): boolean =>
  a.trim().toLocaleLowerCase() === b.trim().toLocaleLowerCase()

/** The org row a pulse person is: named on their page, else the same Slack or ClickUp id, else the same name. */
export function matchHqOrgPerson(
  person: PulseLike,
  org: readonly HqOrgPerson[],
  pages: readonly HqPersonPage[]
): HqOrgPerson | null {
  const pageKey = pages.find((page) => page.pulsePersonId === person.id)?.orgKey
  return (
    (pageKey ? org.find((row) => row.key === pageKey) : undefined) ??
    (person.slackUserId ? org.find((row) => row.slackUserId === person.slackUserId) : undefined) ??
    (person.clickupUserId
      ? org.find((row) => row.clickupUserId === person.clickupUserId)
      : undefined) ??
    org.find((row) => sameName(row.name, person.name)) ??
    null
  )
}

/** The role pulse keeps for an org row: «Head of IT · IT». */
export function hqOrgRole(row: HqOrgPerson): string | null {
  return [row.jobTitle, row.department].filter(Boolean).join(' · ') || null
}

export const HqPeopleRowSchema = z.object({
  key: z.string(),
  /** The owner's name for them where pulse has one («Петя»), else the org name. */
  name: z.string(),
  orgName: z.string().nullable(),
  jobTitle: z.string().nullable(),
  department: z.string().nullable(),
  location: z.string().nullable(),
  supervisorKey: z.string().nullable(),
  slackUserId: z.string().nullable(),
  clickupUserId: z.string().nullable(),
  /** Custom build (hq-closed-loop): absent from older hosts. */
  email: z.string().nullable().optional(),
  slackHandle: z.string().nullable().optional(),
  pulsePersonId: z.string().nullable(),
  pagePath: z.string().nullable(),
  /** Open waitings: they wait on the owner / the owner waits on them. */
  onMe: z.number(),
  onThem: z.number(),
  /** Custom build (hq-closed-loop): the dossier on their page; absent from older hosts. */
  aliases: z.array(z.string()).optional(),
  projects: z.array(z.object({ slug: z.string(), role: z.string().nullable() })).optional(),
  decides: z.array(z.string()).optional(),
  channel: z.record(z.string(), z.string()).optional(),
  timezone: z.string().nullable().optional()
})
export type HqPeopleRow = z.infer<typeof HqPeopleRowSchema>

export type HqPeopleResult = { ok: true; people: HqPeopleRow[] } | { ok: false; error: string }

export function readHqPeople(value: unknown): HqPeopleRow[] {
  const parsed = z.object({ people: z.array(HqPeopleRowSchema) }).safeParse(value)
  return parsed.success ? parsed.data.people : []
}

const CardItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  at: z.number(),
  project: z.string().nullable()
})
export type HqPersonCardItem = z.infer<typeof CardItemSchema>

export const HqPersonCardSchema = z.object({
  notes: z.string().nullable(),
  onMe: z.array(CardItemSchema),
  onThem: z.array(CardItemSchema),
  /** What went to them through Approve, newest first. */
  sent: z.array(CardItemSchema)
})
export type HqPersonCard = z.infer<typeof HqPersonCardSchema>

export type HqPersonCardResult = ({ ok: true } & HqPersonCard) | { ok: false; error: string }

export function readHqPersonCard(value: unknown): HqPersonCard | null {
  const parsed = HqPersonCardSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

/** People the owner works with: they have a page or pulse records. */
export function isHqKnownPerson(row: HqPeopleRow): boolean {
  return row.pagePath !== null || row.pulsePersonId !== null
}

/** The «prepare for a meeting» chat's first message. */
export function hqMeetingPrepPrompt(row: HqPeopleRow): string {
  const who = [row.name, row.orgName && row.orgName !== row.name ? `(${row.orgName})` : null]
    .filter(Boolean)
    .join(' ')
  const role = row.jobTitle ? `, ${row.jobTitle}` : ''
  return (
    `Подготовь меня к встрече с ${who}${role} (скилл ask-hq). Коротко, списком: что открыто между нами ` +
    '(кто кого ждёт), что я обещал, что ушло через Approve, темы Slack и задачи ClickUp с ним за две ' +
    `недели, заметки из HQ${row.pagePath ? ` (${row.pagePath})` : ''}. В конце — 3 вопроса, которые стоит обсудить.`
  )
}

const folded = (text: string): string => text.trim().toLocaleLowerCase()

/** Custom build (hq-closed-loop): who a name, @handle, Slack/ClickUp id or org key means — an exact
 *  match first, then names and aliases that contain the words. */
export function findHqPeople(rows: readonly HqPeopleRow[], query: string): HqPeopleRow[] {
  const asked = folded(query).replace(/^@/, '')
  if (!asked) {
    return []
  }
  const names = (row: HqPeopleRow): string[] =>
    [row.name, row.orgName, row.slackHandle, ...(row.aliases ?? [])]
      .filter((name): name is string => Boolean(name))
      .map(folded)
  const ids = (row: HqPeopleRow): string[] =>
    [row.key, row.pulsePersonId, row.slackUserId, row.clickupUserId, row.email]
      .filter((id): id is string => Boolean(id))
      .map(folded)
  const exact = rows.filter((row) => ids(row).includes(asked) || names(row).includes(asked))
  if (exact.length > 0) {
    return exact
  }
  const words = asked.split(/\s+/)
  return rows.filter((row) => words.every((word) => names(row).some((name) => name.includes(word))))
}

/** Custom build (hq-closed-loop): the people a project's dossiers name, with their role in it. */
export function hqPeopleOfProject(
  rows: readonly HqPeopleRow[],
  project: string
): { row: HqPeopleRow; role: string | null }[] {
  return rows.flatMap((row) => {
    const held = row.projects?.find((entry) => entry.slug === project)
    return held ? [{ row, role: held.role }] : []
  })
}

/** Where to write them, said in one line: the default first, then per kind. */
export function hqPersonChannelLine(channel: Record<string, string> | undefined): string | null {
  const entries = Object.entries(channel ?? {})
  if (entries.length === 0) {
    return null
  }
  const first = channel?.default
  const rest = entries
    .filter(([kind]) => kind !== 'default')
    .map(([kind, where]) => `${kind}: ${where}`)
  return [first, ...rest].filter(Boolean).join(' · ')
}
