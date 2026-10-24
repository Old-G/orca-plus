// Custom build (hq-plus-routing): reads HQ/routing.yaml. A rule it cannot read acts on nothing — a
// broken file means «do nothing by yourself», never «do everything».
import { parse } from 'yaml'
import {
  HQ_ROUTING_DEFAULT_MIN_FREE,
  HQ_ROUTING_DO,
  type HqFindingRule,
  type HqRouting
} from '../../shared/hq-routing'
import { HQ_REPLY_DO, type HqReplyRule } from '../../shared/hq-reply-routing'
import type { HqLadder } from '../../shared/hq-ladder'

const FINDING_KIND = 'review.finding'
const REPLY_KIND = 'person.reply'
const KNOWN_KEYS = new Set([FINDING_KIND, REPLY_KIND, 'min_free', 'ladder'])

function field(value: unknown, key: string): unknown {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? Reflect.get(value, key)
    : undefined
}

function readSev(value: unknown): number[] | null {
  const list = Array.isArray(value) ? value : [value]
  const levels = list.map((item) => /^P([0-3])$/i.exec(String(item ?? '').trim())?.[1])
  return levels.every((level) => level !== undefined) && levels.length > 0
    ? levels.map(Number)
    : null
}

function readAt(value: unknown): number | null | undefined {
  if (value === undefined || value === null) {
    return null
  }
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(String(value).trim())
  return match ? Number(match[1]) * 60 + Number(match[2]) : undefined
}

function readSince(value: unknown): number | null | undefined {
  if (value === undefined || value === null) {
    return null
  }
  // Why: a bare date is the owner's day, in local time, as the rest of the file reads.
  const text = value instanceof Date ? value.toISOString().slice(0, 10) : String(value).trim()
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text)
  if (day) {
    return new Date(Number(day[1]), Number(day[2]) - 1, Number(day[3])).getTime()
  }
  const at = Date.parse(text)
  return Number.isNaN(at) ? undefined : at
}

function readFindingRule(raw: unknown, index: number, problems: string[]): HqFindingRule | null {
  const where = `${FINDING_KIND}[${index}]`
  const sev = readSev(field(field(raw, 'when'), 'sev'))
  const action = HQ_ROUTING_DO.find((known) => known === field(raw, 'do'))
  const atMinute = readAt(field(raw, 'at'))
  const since = readSince(field(raw, 'since'))
  if (!sev) {
    problems.push(`${where}: when.sev takes P0…P3`)
  }
  if (!action) {
    problems.push(`${where}: do takes ${HQ_ROUTING_DO.join(' or ')}`)
  }
  if (atMinute === undefined) {
    problems.push(`${where}: at takes HH:MM`)
  }
  if (since === undefined) {
    problems.push(`${where}: since takes a date (YYYY-MM-DD)`)
  }
  return sev && action && atMinute !== undefined && since !== undefined
    ? { sev, atMinute, do: action, since }
    : null
}

// Custom build (hq-plus-person-replies): the first readable `person.reply` rule; the conditions that
// keep an answer a card are fixed in code, so the file can only make passing rarer, never riskier.
function readReplyRule(raw: unknown, problems: string[]): HqReplyRule | null {
  const rules = Array.isArray(raw) ? raw : [raw]
  for (const [index, rule] of rules.entries()) {
    const where = `${REPLY_KIND}[${index}]`
    const action = HQ_REPLY_DO.find((known) => known === field(rule, 'do'))
    const since = readSince(field(rule, 'since'))
    if (!action) {
      problems.push(`${where}: do takes ${HQ_REPLY_DO.join(' or ')}`)
    }
    if (since === undefined) {
      problems.push(`${where}: since takes a date (YYYY-MM-DD)`)
    }
    if (action && since !== undefined) {
      return { do: action, since }
    }
  }
  return null
}

const LADDER_KEY = 'ladder'
const STEPS = [0, 1, 2, 3] as const

/** Custom build (hq-plus-ladder): `ladder: { kind: 1, other: { step: 2, allow_people: true } }`. */
function readLadder(raw: unknown, problems: string[]): HqLadder {
  if (raw === undefined || raw === null) {
    return {}
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    problems.push('ladder must be a map of action kinds to steps')
    return {}
  }
  const ladder: HqLadder = {}
  for (const [kind, value] of Object.entries(raw)) {
    const stepValue = typeof value === 'object' && value !== null ? field(value, 'step') : value
    const step = STEPS.find((candidate) => candidate === Number(stepValue))
    if (step === undefined) {
      problems.push(`ladder.${kind}: a step is 0, 1, 2 or 3`)
      continue
    }
    const allowPeople =
      typeof value === 'object' && value !== null && field(value, 'allow_people') === true
    ladder[kind] = { step, allowPeople }
  }
  return ladder
}

export function parseHqRouting(text: string | null): HqRouting {
  const routing: HqRouting = {
    findings: [],
    replies: null,
    minFreePercent: HQ_ROUTING_DEFAULT_MIN_FREE,
    ladder: {},
    problems: []
  }
  if (text === null || !text.trim()) {
    return routing
  }
  let doc: unknown
  try {
    doc = parse(text)
  } catch (error) {
    routing.problems.push(
      `routing.yaml is not valid YAML: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`
    )
    return routing
  }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    routing.problems.push('routing.yaml must be a map of event kinds')
    return routing
  }
  for (const key of Object.keys(doc)) {
    if (!KNOWN_KEYS.has(key)) {
      routing.problems.push(`${key}: Orca+ does not act on this kind yet`)
    }
  }
  const minFree = field(doc, 'min_free')
  if (minFree !== undefined) {
    const value = Number(minFree)
    if (Number.isFinite(value) && value >= 0 && value <= 100) {
      routing.minFreePercent = value
    } else {
      routing.problems.push('min_free takes 0…100')
    }
  }
  const rules = field(doc, FINDING_KIND)
  if (rules !== undefined && !Array.isArray(rules)) {
    routing.problems.push(`${FINDING_KIND} must be a list of rules`)
  }
  for (const [index, raw] of (Array.isArray(rules) ? rules : []).entries()) {
    const rule = readFindingRule(raw, index, routing.problems)
    if (rule) {
      routing.findings.push(rule)
    }
  }
  const replies = field(doc, REPLY_KIND)
  if (replies !== undefined && replies !== null) {
    routing.replies = readReplyRule(replies, routing.problems)
  }
  routing.ladder = readLadder(field(doc, LADDER_KEY), routing.problems)
  return routing
}

/** The first rule that covers a finding of this level. */
export function hqFindingRuleFor(routing: HqRouting, level: number): HqFindingRule | null {
  return routing.findings.find((rule) => rule.sev.includes(level)) ?? null
}
