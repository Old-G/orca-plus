// Custom build (hq-closed-loop): `orca hq person` and `orca hq who` as an agent reads them — one
// person in at most 30 lines, or a project's people with their role.
import {
  hqPersonChannelLine,
  type HqPeopleRow,
  type HqPersonCard,
  type HqPersonCardItem
} from '../shared/hq-people'

export type HqPersonResult = {
  query: string
  total: number
  people: { row: HqPeopleRow; card: HqPersonCard | null }[]
}

export type HqWhoResult = { project: string; people: { row: HqPeopleRow; role: string | null }[] }

const LIST_MAX = 4
const NOTES_MAX = 8

const day = (at: number): string => new Date(at).toISOString().slice(0, 10)

function items(title: string, list: readonly HqPersonCardItem[]): string[] {
  if (list.length === 0) {
    return []
  }
  return [
    `${title} (${list.length}):`,
    ...list
      .slice(0, LIST_MAX)
      .map(
        (entry) =>
          `  - ${entry.title}${entry.project ? ` · ${entry.project}` : ''} · ${day(entry.at)}`
      )
  ]
}

function headline(row: HqPeopleRow): string {
  const other = row.orgName && row.orgName !== row.name ? ` (${row.orgName})` : ''
  const role = [row.jobTitle, row.department].filter(Boolean).join(' · ')
  return `${row.name}${other}${role ? ` — ${role}` : ''}`
}

function ids(row: HqPeopleRow): string | null {
  const parts = [
    row.slackHandle ? `@${row.slackHandle}` : null,
    row.slackUserId ? `Slack ${row.slackUserId}` : null,
    row.email,
    row.clickupUserId ? `ClickUp ${row.clickupUserId}` : null
  ].filter(Boolean)
  return parts.length > 0 ? parts.join(' · ') : null
}

function projectsLine(row: HqPeopleRow): string | null {
  const list = row.projects ?? []
  return list.length > 0
    ? list.map((entry) => (entry.role ? `${entry.slug} (${entry.role})` : entry.slug)).join(' · ')
    : null
}

function onePerson(row: HqPeopleRow, card: HqPersonCard | null): string[] {
  const field = (label: string, value: string | null | undefined): string[] =>
    value ? [`${label}: ${value}`] : []
  const gaps = [
    (row.projects ?? []).length === 0 ? 'projects' : null,
    hqPersonChannelLine(row.channel) ? null : 'where to write'
  ].filter(Boolean)
  const notes = (card?.notes ?? '').split('\n').filter((line) => line.trim())
  return [
    headline(row),
    ...field('also', (row.aliases ?? []).join(', ') || null),
    ...field('projects', projectsLine(row)),
    ...field('decides', (row.decides ?? []).join('; ') || null),
    ...field('write', hqPersonChannelLine(row.channel)),
    ...field('ids', ids(row)),
    ...field('timezone', row.timezone),
    ...items('we wait on them', card?.onThem ?? []),
    ...items('they wait on us', card?.onMe ?? []),
    ...items('sent through Approve', card?.sent ?? []),
    ...(notes.length > 0
      ? ['notes:', ...notes.slice(0, NOTES_MAX).map((line) => `  ${line.trim()}`)]
      : []),
    ...field('page', row.pagePath),
    ...(gaps.length > 0
      ? [`not known yet: ${gaps.join(', ')} — ask the owner, then add it to the page`]
      : [])
  ]
}

export function formatHqPerson(result: HqPersonResult): string {
  if (result.people.length === 0) {
    return `Nobody in HQ matches «${result.query}». \`orca hq person\` takes a name, @handle, Slack or ClickUp id.`
  }
  if (result.people.length === 1) {
    const [only] = result.people
    return onePerson(only.row, only.card).join('\n')
  }
  return [
    `${result.total} people match «${result.query}»; name one:`,
    ...result.people.map(
      ({ row }) => `- ${headline(row)}${row.slackHandle ? ` · @${row.slackHandle}` : ''}`
    )
  ].join('\n')
}

export function formatHqWho(result: HqWhoResult): string {
  if (result.people.length === 0) {
    return `No dossier in HQ names ${result.project} yet. Add \`projects: [{slug: ${result.project}, role: …}]\` to people/<name>.md.`
  }
  return [
    `${result.project}:`,
    ...result.people.map(({ row, role }) => {
      const write = hqPersonChannelLine(row.channel)
      return `- ${row.name}${role ? ` — ${role}` : ''}${write ? ` · write: ${write}` : ''}`
    })
  ].join('\n')
}
