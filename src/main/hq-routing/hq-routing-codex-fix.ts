// Custom build (hq-plus-routing): which Codex findings get a fixing chat now — the evening's open
// P0/P1 rows nobody took yet, one chat per project and day — and what that chat is told.
import type { HqAutonomyConfig } from '../../shared/hq-autonomy'
import { hqAutonomyFor } from '../../shared/hq-autonomy'
import type { HqJournalEntry } from '../../shared/hq-journal'
import { hqThreadAddress } from '../../shared/hq-journal'
import type { HqRouteAction, HqRouteHandled, HqRouting } from '../../shared/hq-routing'
import { hqFindingRuleFor } from './hq-routing-rules'

const LEVEL = /^\[P(\d)\]/

export function hqFindingLevel(entry: Pick<HqJournalEntry, 'title'>): number | null {
  const match = LEVEL.exec(entry.title)
  return match ? Number(match[1]) : null
}

/** The owner's day, `YYYY-MM-DD` in local time. */
export function hqLocalDay(at: number): string {
  const date = new Date(at)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function hqStartOfDay(at: number): number {
  const date = new Date(at)
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

export function hqCodexFixAddress(project: string, at: number): string {
  return (
    hqThreadAddress(project, `codex-fix-${hqLocalDay(at)}`) ?? `chat/codex-fix-${hqLocalDay(at)}`
  )
}

export type HqCodexFixPlanInput = {
  routing: HqRouting
  now: number
  /** Open review.finding rows. */
  findings: readonly HqJournalEntry[]
  autonomy: HqAutonomyConfig
  /** The fixing chat each project got today. */
  today: ReadonlyMap<string, { sessionId: string; address: string }>
  freePercent: number | null
  /** The owner ran it by hand: the hour and the Claude limit do not hold it back. */
  manual: boolean
  /** Replaces the rules' `since`, for a dry run over the past. */
  since?: number
}

export function planHqCodexFix(input: HqCodexFixPlanInput): HqRouteAction[] {
  const dayStart = hqStartOfDay(input.now)
  const byProject = new Map<string, { workspace: string; ids: string[] }>()
  for (const finding of input.findings) {
    const level = hqFindingLevel(finding)
    const rule = level === null ? null : hqFindingRuleFor(input.routing, level)
    const since = input.since ?? rule?.since ?? null
    const due =
      input.manual ||
      !rule ||
      rule.atMinute === null ||
      input.now >= dayStart + rule.atMinute * 60_000
    if (
      !rule ||
      rule.do !== 'open_session' ||
      !due ||
      finding.status !== 'open' ||
      finding.address !== null ||
      !finding.project ||
      (since !== null && finding.at < since)
    ) {
      continue
    }
    const group = byProject.get(finding.project) ?? { workspace: finding.workspace, ids: [] }
    group.ids.push(finding.id)
    byProject.set(finding.project, group)
  }
  const limitOk =
    input.manual ||
    (input.freePercent !== null && input.freePercent >= input.routing.minFreePercent)
  // Why: an unread limit must not hold the evening forever; it lets one fixing chat through, no more.
  let unreadAllowance = input.freePercent === null && input.today.size === 0 ? 1 : 0
  return [...byProject].map(([project, { workspace, ids }]): HqRouteAction => {
    const level = hqAutonomyFor(input.autonomy, project)
    const today = input.today.get(project)
    const base = { project, workspace, findings: ids, level }
    if (level === 0) {
      return { ...base, kind: 'suggest', address: null, sessionId: null, note: 'autonomy 0' }
    }
    if (today) {
      return { ...base, kind: 'continue', ...today, note: null }
    }
    if (!limitOk && unreadAllowance > 0) {
      unreadAllowance -= 1
      return {
        ...base,
        kind: 'open',
        address: hqCodexFixAddress(project, input.now),
        sessionId: null,
        note: 'Claude usage is unread — one fixing chat this evening'
      }
    }
    if (!limitOk) {
      return {
        ...base,
        kind: 'wait',
        address: null,
        sessionId: null,
        note:
          input.freePercent === null
            ? 'Claude usage is unread'
            : `Claude limit ${Math.round(input.freePercent)}% free < ${input.routing.minFreePercent}%`
      }
    }
    return {
      ...base,
      kind: 'open',
      address: hqCodexFixAddress(project, input.now),
      sessionId: null,
      note: null
    }
  })
}

/**
 * Custom build (hq-fix-now-all): «Fix now» on a report — the owner agreed to fix all of it, so every
 * finding no chat took yet goes, minor ones too, whatever the rules' levels and hour say. One chat per
 * project: today's fixing chat takes more, a level-0 project asks first. A taken finding is reported
 * as handled, with the commit it was closed with when there is one.
 */
export function planHqReportFix(input: {
  now: number
  /** The report's review.finding rows, oldest first. */
  findings: readonly HqJournalEntry[]
  autonomy: HqAutonomyConfig
  today: ReadonlyMap<string, { sessionId: string; address: string }>
  /** Commits named when a chat settled a finding, by finding id; null when it named none. */
  settled: ReadonlyMap<string, string | null>
}): { actions: HqRouteAction[]; handled: HqRouteHandled[] } {
  const handled: HqRouteHandled[] = []
  const byProject = new Map<string, { workspace: string; ids: string[] }>()
  for (const finding of input.findings) {
    if (!finding.project) {
      continue
    }
    if (finding.address !== null || input.settled.has(finding.id)) {
      handled.push({
        project: finding.project,
        title: finding.title,
        address: finding.address,
        commit: input.settled.get(finding.id) ?? null
      })
      continue
    }
    const group = byProject.get(finding.project) ?? { workspace: finding.workspace, ids: [] }
    group.ids.push(finding.id)
    byProject.set(finding.project, group)
  }
  const actions = [...byProject].map(([project, { workspace, ids }]): HqRouteAction => {
    const level = hqAutonomyFor(input.autonomy, project)
    const base = { project, workspace, findings: ids, level }
    const today = input.today.get(project)
    if (level === 0) {
      return { ...base, kind: 'suggest', address: null, sessionId: null, note: 'autonomy 0' }
    }
    return today
      ? { ...base, kind: 'continue', ...today, note: null }
      : {
          ...base,
          kind: 'open',
          address: hqCodexFixAddress(project, input.now),
          sessionId: null,
          note: null
        }
  })
  return { actions, handled }
}

/** The commits the evening review read for the section holding these findings; short shas. */
export function hqReviewedCommits(report: string, titles: readonly string[]): string[] {
  const sections = report.split(/^(?=## )/m)
  // Why: a journal title is cut at its limit with «…»; the report line holds the whole of it.
  const heads = titles.map((title) => `**${title.replace(/…$/, '')}`)
  const section = sections.find((text) => heads.some((head) => text.includes(head)))
  if (!section) {
    return []
  }
  const listed = /^Коммиты: (.+)$/m.exec(section)?.[1] ?? section.split('\n')[0] ?? ''
  return [...listed.matchAll(/`([0-9a-f]{7,40})`/g)].map((match) => match[1] ?? '')
}

const LEVEL_RULES: Readonly<Record<number, string>> = {
  1: 'Уровень проекта 1: работай только в этом worktree, коммиты локальные — ничего не пушь и не открывай MR.',
  2: 'Уровень проекта 2: можно запушить свою ветку и открыть MR/PR по правилам проекта; не вливай.',
  3: 'Уровень проекта 3: можно влить по правилам проекта (зелёный CI на голове, ревью без блокеров).'
}

/** Custom build (hq-fix-now-all): how a fixing chat merges beside other chats of the same project. */
function mergeRules(project: string, address: string): string[] {
  return [
    'Рядом могут работать другие чаты этого проекта. Перед вливанием (или пушем в общую ветку):',
    `1. \`orca hq merge-slot take ${project}\` — занято другим чатом: подожди 2 минуты и повтори (до 30 минут);`,
    `2. получил слот — подтяни свежую целевую ветку, сделай rebase, снова прогони тесты; после rebase и после тестов повтори \`orca hq merge-slot take ${project}\` — это продлевает слот ещё на 30 минут;`,
    `3. влей по правилам проекта, потом \`orca hq merge-slot release ${project}\` — и при ошибке тоже.`,
    `Что меняли другие: \`orca hq events --project ${project} --since 1d\`; написать чату — \`orca chat send <адрес> "<текст>"\` (твой адрес: ${address}).`,
    'Если вливание в целевую ветку само выкатывает прод (деплой в CI) — не вливай: открой MR и спроси владельца через `orca hq report --ask "Влить и выкатить <MR>?"`.'
  ]
}

export function hqCodexFixPrompt(input: {
  projectName: string
  /** The project's slug, for the merge slot and the journal. */
  project: string
  address: string
  level: number
  findings: readonly HqJournalEntry[]
  commits: readonly string[]
}): string {
  const findings = input.findings.flatMap((finding) => [
    `- ${finding.id} · ${finding.title}`,
    ...(finding.body ? finding.body.split('\n').map((line) => `  ${line}`) : [])
  ])
  return [
    `Orca+ · Codex: починить — ${input.projectName}`,
    '',
    `Ревью Codex нашло в коммитах проекта замечания. Нить: ${input.address}. Ты в отдельном worktree от ветки, где лежат эти коммиты.`,
    '',
    'Находки (текст Codex дословно, id — строка журнала):',
    '"""',
    ...findings,
    '"""',
    ...(input.commits.length > 0 ? ['', `Проверенные коммиты: ${input.commits.join(', ')}`] : []),
    '',
    'По каждой находке сначала реши, нужно ли чинить:',
    '- «уже исправлено» — найди коммит, который это закрыл;',
    '- «не нужно» — коротко почему (Codex ошибся, так задумано);',
    '- «чиню» — сначала тест, который падает на этой ошибке, потом фикс, тест зелёный, коммит по правилам проекта.',
    '',
    LEVEL_RULES[input.level] ?? LEVEL_RULES[1],
    'Прод (деплой, живые данные, прод-флоу) и выкатку Orca+ не трогай ни при каком уровне — только после «да» владельца. Сообщения людям — только через Approve.',
    '',
    ...mergeRules(input.project, input.address),
    '',
    'Закрой каждую находку командой:',
    '- `orca hq settle <id> --done --commit <sha>` — починено или уже исправлено;',
    '- `orca hq settle <id> --dropped --why "<почему>"` — не нужно.',
    `В конце — \`orca hq report --address ${input.address}\` с итогом: что починено, что нет и почему.`
  ].join('\n')
}

export function hqCodexFixFollowUp(input: {
  findings: readonly HqJournalEntry[]
  commits: readonly string[]
}): string {
  return [
    'Orca+ · ещё находки Codex по этому проекту — тот же порядок: решить, починить с тестом, закрыть `orca hq settle`.',
    '"""',
    ...input.findings.flatMap((finding) => [
      `- ${finding.id} · ${finding.title}`,
      ...(finding.body ? finding.body.split('\n').map((line) => `  ${line}`) : [])
    ]),
    '"""',
    ...(input.commits.length > 0 ? [`Проверенные коммиты: ${input.commits.join(', ')}`] : [])
  ].join('\n')
}
