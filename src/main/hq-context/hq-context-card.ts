// Custom build (hq-plus-context): the project card a chat reads on start — at most 60 lines, every
// block naming where it comes from and how old that source is, so a stale line is never taken for news.
import {
  HQ_CONTEXT_MAX_LINES,
  HQ_ROOM_CONTEXT_MAX_LINES,
  type HqPlan
} from '../../shared/hq-context'
import type { HqJournalEntry, HqSession } from '../../shared/hq-journal'
import type { PulseDecision, PulseWaiting } from '../../shared/pulse-types'

const HOUR_MS = 3_600_000
const DAY_MS = 24 * HOUR_MS
// Why: a project page is synced nightly and a plan moves every few days; older is suspicious.
export const HQ_PAGE_STALE_MS = 7 * DAY_MS
export const HQ_PLAN_STALE_MS = 14 * DAY_MS
const LIVE_SESSION_MS = 12 * HOUR_MS
const PER_BLOCK = 6

export type HqContextCardInput = {
  project: string
  title: string | null
  status: string | null
  roomName: string | null
  autonomy: number | null
  page: { path: string; syncedAt: number | null } | null
  plan: { path: string; changedAt: number; plan: HqPlan } | null
  waitings: readonly PulseWaiting[]
  /** Decisions, what went out through Approve, people's answers — newest first. */
  agreements: readonly { at: number; text: string }[]
  sessions: readonly HqSession[]
  reports: readonly HqJournalEntry[]
  personName: (id: string | null) => string | null
  /** Custom build (hq-closed-loop): who works on it, by the dossiers in HQ's `people/`. */
  people?: readonly { name: string; role: string | null; write: string | null }[]
  where: readonly { label: string; value: string }[]
  now: number
}

export function hqAge(at: number | null, now: number): string {
  if (at === null) {
    return 'дата неизвестна'
  }
  const ms = Math.max(0, now - at)
  if (ms < HOUR_MS) {
    return `${Math.max(1, Math.round(ms / 60_000))} мин назад`
  }
  return ms < DAY_MS ? `${Math.round(ms / HOUR_MS)} ч назад` : `${Math.floor(ms / DAY_MS)} дн назад`
}

function day(at: number): string {
  const date = new Date(at)
  return `${String(date.getDate()).padStart(2, '0')}.${String(date.getMonth() + 1).padStart(2, '0')}`
}

function oneLine(text: string, max = 110): string {
  const line = text.replace(/\s+/g, ' ').trim()
  return line.length > max ? `${line.slice(0, max - 1)}…` : line
}

function block(title: string, source: string, rows: string[], empty: string): string[] {
  const shown = rows.slice(0, PER_BLOCK)
  const more = rows.length - shown.length
  return [
    `## ${title} · ${source}`,
    ...(shown.length > 0 ? shown : [`- ${empty}`]),
    ...(more > 0 ? [`- …и ещё ${more}`] : [])
  ]
}

function stale(at: number | null, limit: number, now: number): string {
  return at === null || now - at > limit ? ' · ⚠ устарело' : ''
}

function planBlock(input: HqContextCardInput): string[] {
  const { plan, now } = input
  if (!plan) {
    return block('План', 'нет plans/<проект>.md', [], 'плана нет — шаг не известен')
  }
  const { current, blocked, steps } = plan.plan
  const done = steps.filter((step) => step.done).length
  const rows = [
    current
      ? `- ▶ ${current.id} ${current.title}${current.stage ? ` (${current.stage})` : ''}${plan.plan.marked ? '' : ' — первый открытый, ▶ в плане нет'}`
      : '- ▶ открытых шагов нет',
    ...blocked.map((step) => `- ■ ${step.id} ${step.title} — ${oneLine(step.blockedBy ?? '', 70)}`),
    `- сделано ${done} из ${steps.length}`
  ]
  return block(
    'План',
    `${plan.path}, изменён ${hqAge(plan.changedAt, now)}${stale(plan.changedAt, HQ_PLAN_STALE_MS, now)}`,
    rows,
    ''
  )
}

function waitingRow(waiting: PulseWaiting, input: HqContextCardInput): string {
  const name = input.personName(waiting.personId)
  const who = name ? `${name}: ` : ''
  const ref =
    waiting.sourceRef && /^[A-Z]+-\d+$/.test(waiting.sourceRef) ? ` ${waiting.sourceRef}` : ''
  const answered = waiting.reply ? ' · есть ответ, не разобран' : ''
  return `- ${who}${oneLine(waiting.title, 80)}${ref} — с ${day(waiting.createdAt)} (${hqAge(waiting.createdAt, input.now)})${answered}`
}

function sessionRow(session: HqSession, now: number): string {
  const name = session.address ?? session.sessionId.slice(0, 14)
  const context = session.contextPct !== null ? ` · контекст ${session.contextPct}%` : ''
  return `- ${name} · ${session.state} · ${hqAge(session.lastActivityAt, now)}${context}`
}

export function buildHqContextCard(input: HqContextCardInput): string[] {
  const { now } = input
  const open = input.waitings.filter((waiting) => waiting.status === 'open')
  const live = input.sessions.filter(
    (session) => session.state !== 'closed' && now - session.lastActivityAt < LIVE_SESSION_MS
  )
  const head = [
    `# ${input.project}${input.title ? ` — ${oneLine(input.title, 70)}` : ''}`,
    `комната: ${input.roomName ?? 'без комнаты'} · уровень автономии: ${input.autonomy ?? '?'} · статус: ${input.status ?? '?'}`,
    input.page
      ? `страница: ${input.page.path}, синхронизирована ${hqAge(input.page.syncedAt, now)}${stale(input.page.syncedAt, HQ_PAGE_STALE_MS, now)}`
      : 'страницы проекта в HQ нет'
  ]
  const lines = [
    ...head,
    ...planBlock(input),
    ...block(
      'Люди',
      'orca hq who · orca hq person <имя>',
      (input.people ?? []).map(
        (person) =>
          `- ${person.name}${person.role ? ` — ${person.role}` : ''}${person.write ? ` · писать: ${person.write}` : ''}`
      ),
      'в досье пока никто не назван'
    ),
    ...block(
      'Кого ждём',
      'orca pulse wait',
      open.filter((w) => w.direction === 'on-them').map((w) => waitingRow(w, input)),
      'никого'
    ),
    ...block(
      'Что должны мы',
      'orca pulse wait',
      open.filter((w) => w.direction === 'on-me').map((w) => waitingRow(w, input)),
      'ничего'
    ),
    ...block(
      'Договорились и отправили',
      'orca pulse decision list · orca hq events',
      input.agreements.slice(0, 5).map((item) => `- ${day(item.at)} ${oneLine(item.text, 100)}`),
      'ничего за последнее время'
    ),
    ...block(
      'Чаты за 12 ч',
      'orca hq events',
      live.map((session) => sessionRow(session, now)),
      'нет'
    ),
    ...block(
      'Последние итоги',
      'orca hq thread <адрес>',
      input.reports
        .slice(0, 3)
        .map(
          (entry) =>
            `- ${day(entry.at)} ${entry.address ? `${entry.address}: ` : ''}${oneLine(entry.title, 95)}`
        ),
      'итогов нет'
    ),
    ...block(
      'Где что',
      'страница проекта HQ',
      input.where.map((item) => `- ${item.label}: ${item.value}`),
      'не указано'
    )
  ]
  return lines.length > HQ_CONTEXT_MAX_LINES
    ? [...lines.slice(0, HQ_CONTEXT_MAX_LINES - 1), '…карточка обрезана до 60 строк']
    : lines
}

/** What a new chat is told: the room's notes, the project's card and how to use them; empty
 *  when there is neither. */
export function hqSessionStartText(notes: string[], card: string[], notesPath: string): string {
  const kept = notes.filter((line, index) => index > 0 || line !== '')
  const shown =
    kept.length > HQ_ROOM_CONTEXT_MAX_LINES
      ? [...kept.slice(0, HQ_ROOM_CONTEXT_MAX_LINES), `…дальше в ${notesPath}`]
      : kept
  if (shown.length === 0 && card.length === 0) {
    return ''
  }
  return [
    '[Orca+ HQ+] Контекст этой сессии, собран при старте.',
    ...(shown.length > 0 ? ['', ...shown] : []),
    ...(card.length > 0
      ? [
          '',
          ...card,
          '',
          'В первом ответе одной строкой назови текущий шаг плана и кого ждём, если это касается задачи; дальше — по сообщению владельца.',
          'Отмечай сделанный шаг: orca hq step <id> --done. Свежая карточка: orca hq context.'
        ]
      : [])
  ].join('\n')
}

/** What was decided, sent through Approve and answered — newest first, each text once. */
export function hqAgreements(
  decisions: readonly PulseDecision[],
  sent: readonly HqJournalEntry[],
  replies: readonly HqJournalEntry[]
): { at: number; text: string }[] {
  const seen = new Set<string>()
  return [
    ...decisions.map((decision) => ({
      at: decision.decidedAt,
      text: `${decision.kind === 'approval' ? '→ отправлено: ' : ''}${decision.title}`
    })),
    ...sent.map((entry) => ({ at: entry.at, text: entry.title })),
    ...replies.map((entry) => ({ at: entry.at, text: `ответ: ${entry.title}` }))
  ]
    .sort((a, b) => b.at - a.at)
    .filter((item) => !seen.has(item.text) && Boolean(seen.add(item.text)))
}
