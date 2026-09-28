// Custom build (hq-pulse-mirror): the Markdown HQ keeps for pulse records. A decision page is
// written once and never rewritten; a person page is ours only between the markers.
import type { PulseDecision, PulsePerson } from '../../shared/pulse-types'

export const PERSON_BLOCK = ['<!-- orca-pulse:person -->', '<!-- /orca-pulse:end -->'] as const
export const PERSON_ID_KEY = 'pulse_person_id'
export const DECISION_ID_KEY = 'pulse_decision_id'
const MAX_SLUG = 60

/** A filename-safe slug that keeps non-Latin letters, so a Russian title stays readable. */
export function pageSlug(text: string, fallback: string): string {
  const slug = text
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG)
    .replace(/-+$/, '')
  return slug || fallback
}

/** YYYY-MM-DD in the local time zone — the day the owner would name. */
export function localDay(ms: number): string {
  const date = new Date(ms)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

const yaml = (value: string): string => JSON.stringify(value)

export type PageLink = { title: string; path: string }

export function renderDecisionPage(
  decision: PulseDecision,
  person: PageLink | null,
  projectPage: string | null
): string {
  const front = [
    '---',
    `${DECISION_ID_KEY}: ${yaml(decision.id)}`,
    `decided_at: ${yaml(new Date(decision.decidedAt).toISOString())}`,
    ...(decision.project ? [`project: ${yaml(decision.project)}`] : []),
    ...(person ? [`person: ${yaml(person.path)}`] : []),
    `source: ${yaml(decision.source)}`,
    '---'
  ]
  const facts = [
    decision.project
      ? `- **Project:** ${projectPage ? `[${decision.project}](${projectPage})` : decision.project}`
      : null,
    person ? `- **With:** [${person.title}](${person.path})` : null,
    `- **Recorded by:** ${decision.source} · ${localDay(decision.decidedAt)}`
  ].filter((line): line is string => line !== null)
  return [
    ...front,
    '',
    `# ${decision.title}`,
    '',
    ...(decision.body ? [decision.body.trim(), ''] : []),
    ...facts,
    ''
  ].join('\n')
}

export function renderPersonBlock(person: PulsePerson, decisions: PageLink[]): string {
  const ids = [
    person.slackUserId ? `**Slack:** ${person.slackUserId}` : null,
    person.clickupUserId ? `**ClickUp:** ${person.clickupUserId}` : null
  ].filter((part): part is string => part !== null)
  const lines = [
    PERSON_BLOCK[0],
    ...(person.role ? [`- **Role:** ${person.role}`] : []),
    ...(ids.length > 0 ? [`- ${ids.join(' · ')}`] : []),
    ...(person.notes ? [`- **Notes:** ${person.notes}`] : []),
    decisions.length > 0 ? '- **Decisions:**' : '- **Decisions:** none yet',
    ...decisions.map((d) => `  - [${d.title}](${d.path})`),
    PERSON_BLOCK[1]
  ]
  return lines.join('\n')
}

export function newPersonPage(person: PulsePerson, block: string): string {
  return [
    '---',
    `${PERSON_ID_KEY}: ${yaml(person.id)}`,
    '---',
    '',
    `# ${person.name}`,
    '',
    block,
    '',
    '## Notes',
    ''
  ].join('\n')
}

/** The page with our block replaced; null when the owner removed the markers. */
export function replacePersonBlock(page: string, block: string): string | null {
  const start = page.indexOf(PERSON_BLOCK[0])
  const end = page.indexOf(PERSON_BLOCK[1])
  if (start === -1 || end < start) {
    return null
  }
  return page.slice(0, start) + block + page.slice(end + PERSON_BLOCK[1].length)
}

/** A top-level frontmatter value written by this module (a JSON-quoted string). */
export function readFrontValue(page: string, key: string): string | null {
  const front = /^---\n([\s\S]*?)\n---/.exec(page)
  const line = front?.[1].split('\n').find((entry) => entry.startsWith(`${key}:`))
  if (!line) {
    return null
  }
  const raw = line.slice(key.length + 1).trim()
  try {
    const parsed: unknown = JSON.parse(raw)
    return typeof parsed === 'string' ? parsed : null
  } catch {
    return raw || null
  }
}
