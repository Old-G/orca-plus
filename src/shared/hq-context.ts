// Custom build (hq-plus-context): what a chat learns about its project on start — the project card
// (`orca hq context`), the room's own notes (`HQ/workspaces/<room>/context.md`) and the project's
// plan (`HQ/plans/<project>.md`), whose steps agents tick with `orca hq step`.

export const HQ_CONTEXT_MAX_LINES = 60
export const HQ_ROOM_CONTEXT_FILE = 'context.md'
export const HQ_PLANS_DIR = 'plans'
export const HQ_WHERE_FILE = 'wiki/where.md'
/** A room's notes go in whole up to this; the rest stays in the file. */
export const HQ_ROOM_CONTEXT_MAX_LINES = 30

export const HQ_CONTEXT_KIND = { planStep: 'plan.step', roomAdded: 'room.added' } as const

export type HqPlanStep = {
  /** `17.4` from `**17.4 …**`, else its place in the plan (`#3`). */
  id: string
  title: string
  done: boolean
  /** Marked `■`: what it waits for. */
  blockedBy: string | null
  /** The `## ` stage it sits under. */
  stage: string | null
  /** 0-based line in the plan file. */
  line: number
}

export type HqPlan = {
  steps: HqPlanStep[]
  /** The step marked `▶`, else the first open one that is not blocked. */
  current: HqPlanStep | null
  /** The plan marks the current step with ▶; false = it is only the first open one. */
  marked: boolean
  blocked: HqPlanStep[]
}

const STEP = /^(\s*[-*] \[)( |x|X)(\] )(.*)$/
const STEP_ID = /^\*\*\s*(\d+(?:\.\d+)*[a-zа-я]?)\.?\s+/i
const HEADING = /^#{2,3} (.+)$/

function stepTitle(rest: string): { id: string | null; title: string } {
  const id = STEP_ID.exec(rest)
  const text = (id ? rest.slice(id[0].length) : rest)
    .replace(/[▶■]/g, '')
    .replace(/\*\*/g, '')
    .trim()
  const title = (/^(.+?)[.:](?:\s|$)/.exec(text)?.[1] ?? text).trim()
  return { id: id ? id[1] : null, title: title.length > 120 ? `${title.slice(0, 119)}…` : title }
}

export function parseHqPlan(markdown: string): HqPlan {
  const steps: HqPlanStep[] = []
  let stage: string | null = null
  let marked: HqPlanStep | null = null
  markdown.split('\n').forEach((raw, line) => {
    const heading = HEADING.exec(raw)
    if (heading) {
      stage = heading[1].trim()
      return
    }
    const match = STEP.exec(raw)
    if (!match) {
      return
    }
    const rest = match[4]
    const { id, title } = stepTitle(rest)
    const blockMark = rest.indexOf('■')
    const step: HqPlanStep = {
      id: id ?? `#${steps.length + 1}`,
      title,
      done: match[2] !== ' ',
      blockedBy:
        blockMark !== -1 && match[2] === ' '
          ? rest
              .slice(blockMark + 1)
              .replace(/\*\*/g, '')
              .trim() || 'причина не указана'
          : null,
      stage,
      line
    }
    steps.push(step)
    if (!step.done && rest.includes('▶')) {
      marked ??= step
    }
  })
  const open = steps.filter((step) => !step.done)
  return {
    steps,
    current: marked ?? open.find((step) => step.blockedBy === null) ?? null,
    marked: marked !== null,
    blocked: open.filter((step) => step.blockedBy !== null)
  }
}

/** The plan with one step ticked or unticked; null when no step has that id. */
export function setHqPlanStep(markdown: string, id: string, done: boolean): string | null {
  const step = parseHqPlan(markdown).steps.find((candidate) => candidate.id === id)
  if (!step) {
    return null
  }
  const lines = markdown.split('\n')
  lines[step.line] = lines[step.line].replace(STEP, (_all, open, _mark, close, rest: string) => {
    const text = done ? rest.replace(/\s*▶\s*/g, ' ').replace(/\s+$/, '') : rest
    return `${open}${done ? 'x' : ' '}${close}${text}`
  })
  return lines.join('\n')
}

export type HqContextResult = {
  project: string
  room: string | null
  roomName: string | null
  /** The card, at most HQ_CONTEXT_MAX_LINES. */
  lines: string[]
  /** How long it took to gather, in ms. */
  ms: number
}

export type HqSessionStartResult = {
  /** What goes into the new chat's context; empty when there is nothing to say. */
  text: string
  project: string | null
  room: string | null
}

export type HqStepResult = { project: string; step: HqPlanStep; changed: boolean }

export type HqWhereAnswer = { question: string; where: string; score: number }
export type HqWhereResult = { answers: HqWhereAnswer[]; file: string }

export type HqRoomAddResult = { slug: string; path: string; created: string[] }

export const HQ_ROOM_CONTEXT_TEMPLATE = [
  '# {{name}} — как здесь работать',
  '',
  '> Читается каждой новой сессией этой комнаты (Orca+ HQ+). Коротко, до 30 строк.',
  '',
  '## Кто есть кто',
  '- <имя> — <роль>, <за что отвечает>, как просить: <канал>',
  '',
  '## Как здесь просят и отвечают',
  '- Задачи: {{tasks}}. Сообщения людям: {{messenger}}, только через Approve.',
  '',
  '## Правила',
  '- Прод — только после «да» владельца.',
  ''
].join('\n')
