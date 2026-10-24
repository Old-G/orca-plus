// Custom build (hq-closed-loop): a person's dossier read from the front matter of their HQ page —
// names they go by, their projects and role in each, what they decide, where to write them.
import { parse } from 'yaml'
import { HQ_EMPTY_DOSSIER, type HqPersonDossier } from '../../shared/hq-people'

const FRONT = /^---\r?\n([\s\S]*?)\r?\n---/

function text(value: unknown): string | null {
  if (typeof value === 'number') {
    return String(value)
  }
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function texts(value: unknown): string[] {
  const list = Array.isArray(value) ? value : value === undefined ? [] : [value]
  return list.flatMap((item) => text(item) ?? [])
}

/** `[{slug, role}]`, or `[slug]` / `{slug: role}` written by hand. */
function projects(value: unknown): HqPersonDossier['projects'] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      if (typeof item === 'string') {
        return text(item) ? [{ slug: item.trim(), role: null }] : []
      }
      const slug = item && typeof item === 'object' ? text(Reflect.get(item, 'slug')) : null
      return slug ? [{ slug, role: text(Reflect.get(item, 'role')) }] : []
    })
  }
  if (value && typeof value === 'object') {
    return Object.entries(value).map(([slug, role]) => ({ slug, role: text(role) }))
  }
  return []
}

/** A plain string is the default place; a map names one per kind of message. */
function channel(value: unknown): Record<string, string> {
  const single = text(value)
  if (single) {
    return { default: single }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }
  return Object.fromEntries(
    Object.entries(value).flatMap(([kind, where]) => {
      const place = text(where)
      return place ? [[kind, place]] : []
    })
  )
}

export function readHqPersonDossier(markdown: string): HqPersonDossier {
  const front = FRONT.exec(markdown)?.[1]
  if (!front) {
    return HQ_EMPTY_DOSSIER
  }
  let data: unknown
  try {
    data = parse(front)
  } catch {
    // Why: a page the owner is mid-way through editing must not hide the person.
    return HQ_EMPTY_DOSSIER
  }
  if (!data || typeof data !== 'object') {
    return HQ_EMPTY_DOSSIER
  }
  const field = (key: string): unknown => Reflect.get(data, key)
  return {
    aliases: texts(field('aliases')),
    projects: projects(field('projects')),
    decides: texts(field('decides')),
    channel: channel(field('channel')),
    timezone: text(field('timezone')),
    slackUserId: text(field('slack_user_id')),
    slackHandle: text(field('slack_handle'))?.replace(/^@/, '') ?? null,
    email: text(field('email')),
    clickupUserId: text(field('clickup_user_id'))
  }
}
