// Custom build (pulse): plain-text views for `orca pulse`.
import type { PulseDecision, PulseDraft, PulsePerson, PulseWaiting } from '../shared/pulse-types'

export type PulsePersonShow = {
  person: PulsePerson
  waitings: PulseWaiting[]
  decisions: PulseDecision[]
}

const DAY_MS = 24 * 60 * 60 * 1000

// Custom build (hq-plus-ask): the day itself, not only the age — answers quote «since 15.10».
function age(since: number, now: number): string {
  const days = Math.floor((now - since) / DAY_MS)
  const date = new Date(since)
  const day = [date.getFullYear(), date.getMonth() + 1, date.getDate()]
    .map((part) => String(part).padStart(2, '0'))
    .join('-')
  return `since ${day} (${days <= 0 ? 'today' : `${days} d`})`
}

function waitingLine(waiting: PulseWaiting, name: string | null, now: number): string {
  const parts = [
    `[${waiting.direction}]`,
    waiting.title,
    name ? `· ${name}` : null,
    waiting.project ? `· ${waiting.project}` : null,
    `· ${age(waiting.createdAt, now)}`,
    waiting.dueAt ? `· due ${new Date(waiting.dueAt).toISOString().slice(0, 10)}` : null,
    waiting.status === 'open' ? null : `· ${waiting.status}`,
    `  ${waiting.id}`
  ]
  return parts.filter((part): part is string => part !== null).join(' ')
}

export function formatWaitingList(
  waitings: PulseWaiting[],
  people: PulsePerson[],
  now: number
): string {
  if (waitings.length === 0) {
    return 'No waitings.'
  }
  const names = new Map(people.map((person) => [person.id, person.name]))
  return waitings
    .map((w) => waitingLine(w, w.personId ? (names.get(w.personId) ?? null) : null, now))
    .join('\n')
}

export function formatDraftList(drafts: PulseDraft[]): string {
  if (drafts.length === 0) {
    return 'No drafts.'
  }
  return drafts
    .map((draft) => {
      const head = [draft.kind, draft.target ? `→ ${draft.target}` : null, `(${draft.status})`]
        .filter((part): part is string => part !== null)
        .join(' ')
      const text = draft.title ?? draft.body.split('\n')[0] ?? ''
      return `${head}: ${text}  ${draft.id}`
    })
    .join('\n')
}

function decisionHaystack(decision: PulseDecision): string {
  const sent = decision.sentContext
  return [
    decision.title,
    decision.body,
    decision.project,
    sent?.targetName,
    sent?.targetId,
    sent?.replyingTo,
    sent?.chatName,
    sent?.project,
    sent?.head,
    sent?.taskId,
    sent?.taskName,
    sent?.ref
  ]
    .filter((part): part is string => Boolean(part))
    .join('\n')
    .toLocaleLowerCase()
}

/** Every word of the query appears somewhere in the decision. */
export function matchesDecisionQuery(decision: PulseDecision, query: string): boolean {
  const haystack = decisionHaystack(decision)
  return query
    .toLocaleLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => haystack.includes(word))
}

const BODY_PREVIEW_CHARS = 240

export function formatDecisionList(decisions: PulseDecision[]): string {
  if (decisions.length === 0) {
    return 'No decisions match.'
  }
  return decisions
    .map((d) => {
      const sent = d.sentContext
      const head = [
        new Date(d.decidedAt).toISOString().slice(0, 16).replace('T', ' '),
        d.outcome ?? d.kind,
        d.title,
        sent?.targetName ? `→ ${sent.targetName}` : null,
        sent?.taskName || sent?.taskId ? `· ${sent.taskName ?? sent.taskId}` : null,
        sent?.chatName ? `· chat «${sent.chatName}»` : null,
        (sent?.project ?? d.project) ? `· ${sent?.project ?? d.project}` : null,
        sent?.ref ? `· ref ${sent.ref}` : null
      ]
        .filter((part): part is string => part !== null)
        .join(' ')
        .concat(`  ${d.id}`)
      const body = d.body?.replace(/\s+/g, ' ').trim()
      return body
        ? `${head}\n    ${body.length > BODY_PREVIEW_CHARS ? `${body.slice(0, BODY_PREVIEW_CHARS)}…` : body}`
        : head
    })
    .join('\n')
}

export function formatPersonShow(show: PulsePersonShow, now: number): string {
  const { person } = show
  const ids = [
    person.slackUserId ? `Slack ${person.slackUserId}` : null,
    person.clickupUserId ? `ClickUp ${person.clickupUserId}` : null
  ].filter((part): part is string => part !== null)
  const lines = [
    `${person.name}${person.role ? ` — ${person.role}` : ''}  ${person.id}`,
    ...(ids.length > 0 ? [ids.join(' · ')] : []),
    ...(person.notes ? [person.notes] : []),
    '',
    show.waitings.length > 0 ? 'Open waitings:' : 'No open waitings.',
    ...show.waitings.map((w) => `  ${waitingLine(w, null, now)}`)
  ]
  if (show.decisions.length > 0) {
    lines.push(
      '',
      'Recent decisions:',
      ...show.decisions.map(
        (d) => `  ${new Date(d.decidedAt).toISOString().slice(0, 10)} ${d.title}`
      )
    )
  }
  return lines.join('\n')
}
