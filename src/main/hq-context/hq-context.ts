// Custom build (hq-plus-context): a project's card (`orca hq context`), what a new chat is told on
// start (the SessionStart hook), plan steps ticked by agents (`orca hq step`), the knowledge map
// (`orca hq where`) and new rooms (`orca hq workspace add`). A chat reads and ticks only its own room.
import { readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { HQ_AUTONOMY_FILE, hqAutonomyFor, parseHqAutonomy } from '../../shared/hq-autonomy'
import {
  HQ_CONTEXT_KIND,
  HQ_PLANS_DIR,
  HQ_ROOM_CONTEXT_FILE,
  HQ_WHERE_FILE,
  parseHqPlan,
  setHqPlanStep,
  type HqContextResult,
  type HqRoomAddResult,
  type HqSessionStartResult,
  type HqStepResult,
  type HqWhereResult
} from '../../shared/hq-context'
import {
  HQ_JOURNAL_ALL_ROOMS,
  HQ_JOURNAL_KIND,
  HQ_JOURNAL_UNASSIGNED,
  type HqJournalEntry,
  type HqJournalInput,
  type HqJournalQuery,
  type HqJournalRecordResult,
  type HqSession
} from '../../shared/hq-journal'
import { HQ_SPACES_DIR } from '../../shared/hq-spaces'
import { hqRoomMcpHidden } from '../../shared/hq-room-mcp'
import type { PulseDecision, PulsePerson, PulseWaiting } from '../../shared/pulse-types'
import { readHqProjectPageFields } from '../hq-project-pages/hq-project-pages'
import {
  hqCallerScope,
  hqPlaceOf,
  type HqCaller,
  type HqRoomSources
} from '../hq-journal/hq-journal-rooms'
import { findHqPlanFile } from './hq-project-plan-file'
import { buildHqContextCard, hqAgreements, hqSessionStartText } from './hq-context-card'
import { matchHqWhere } from './hq-knowledge-map'
import { addHqRoom, hqRoomAddedEntry, type HqRoomAddInput } from './hq-room-add'

const SLUG = /^[A-Za-z0-9][\w.-]{0,100}$/
const DECISIONS_DEPTH = 500

export type HqContextDeps = {
  enabled: () => boolean
  hqPath: () => string | null
  sources: () => Promise<HqRoomSources>
  pulse: {
    listWaitings: () => PulseWaiting[]
    listDecisions: (limit: number) => PulseDecision[]
    listSessionsByProject: (project: string) => HqSession[]
    list: (query: HqJournalQuery) => HqJournalEntry[]
    record: (inputs: readonly HqJournalInput[]) => HqJournalRecordResult
    listPeople: () => PulsePerson[]
  }
  now: () => number
}

export type HqContextService = {
  context: (caller: HqCaller, project?: string) => Promise<HqContextResult>
  sessionStart: (caller: HqCaller) => Promise<HqSessionStartResult>
  step: (
    caller: HqCaller,
    input: { project?: string; id: string; done: boolean }
  ) => Promise<HqStepResult>
  where: (question: string) => Promise<HqWhereResult>
  addRoom: (input: HqRoomAddInput) => Promise<HqRoomAddResult>
}

async function readText(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return null
  }
}

async function changedAt(path: string): Promise<number | null> {
  try {
    return (await stat(path)).mtimeMs
  } catch {
    return null
  }
}

function same(a: string | null | undefined, b: string): boolean {
  return (a ?? '').toLowerCase() === b.toLowerCase()
}

export function createHqContextService(deps: HqContextDeps): HqContextService {
  const hq = (): string => {
    const path = deps.hqPath()
    if (!path) {
      throw new Error('No HQ folder is set in Orca+.')
    }
    return path
  }

  /** The project the caller may read: its own, or one in its room; HQ+ reads any (and it is noted). */
  const resolve = async (
    caller: HqCaller,
    requested: string | undefined
  ): Promise<{
    project: string
    room: string | null
    roomName: string | null
    sources: HqRoomSources
  }> => {
    const sources = await deps.sources()
    const scope = hqCallerScope(sources, caller)
    const project = requested?.trim() || (scope.kind === 'room' ? scope.project : null)
    if (!project) {
      throw new Error('Name the project: orca hq context <project>.')
    }
    if (!SLUG.test(project)) {
      throw new Error(`Not a project slug: ${project}`)
    }
    const place = hqPlaceOf(sources, { project })
    const room = place.room === HQ_JOURNAL_UNASSIGNED ? null : place.room
    if (scope.kind === 'room' && (room ?? HQ_JOURNAL_UNASSIGNED) !== scope.room) {
      throw new Error(`Project ${project} is not in this chat's room; only HQ+ reads other rooms.`)
    }
    if (scope.kind === 'overview' && deps.enabled()) {
      deps.pulse.record([
        {
          workspace: HQ_JOURNAL_ALL_ROOMS,
          kind: HQ_JOURNAL_KIND.crossRead,
          project,
          address: null,
          sessionId: scope.sessionId,
          personId: null,
          title: `HQ+ read the card of ${project}`,
          needs: 'nobody',
          status: 'done',
          replyTo: null,
          refKind: null,
          refId: null,
          source: 'hq-plus',
          dedupeKey: null
        }
      ])
    }
    const roomName = room
      ? (sources.spaces.find((space) => space.slug === room)?.name ?? room)
      : null
    return { project, room, roomName, sources }
  }

  const agreements = (project: string) =>
    hqAgreements(
      deps.pulse.listDecisions(DECISIONS_DEPTH).filter((d) => same(d.project, project)),
      deps.pulse.list({ kind: HQ_JOURNAL_KIND.approveResult, project, limit: 10 }),
      deps.pulse.list({ kind: HQ_JOURNAL_KIND.personReply, project, limit: 10 })
    )

  const card = async (project: string, roomName: string | null, sources: HqRoomSources) => {
    const root = hq()
    const pagePath = `projects/${project}.md`
    const [pageText, planFile, autonomyText] = await Promise.all([
      readText(join(root, pagePath)),
      findHqPlanFile(root, project),
      readText(join(root, HQ_AUTONOMY_FILE))
    ])
    if (pageText === null && planFile === null) {
      throw new Error(`HQ has neither projects/${project}.md nor a plan for ${project}.`)
    }
    const fields = readHqProjectPageFields(pageText ?? '')
    const heading = /^# (.+)$/m.exec(pageText ?? '')?.[1]?.trim() ?? null
    const synced = Date.parse(fields.get('synced_at') ?? '')
    const repoPath = fields.get('path') ?? null
    const wiki = repoPath ? await changedAt(join(repoPath, 'wiki', 'index.md')) : null
    const artifacts = await changedAt(join(root, 'artifacts', project))
    const space = sources.spaces.find((candidate) => candidate.projects.includes(project))
    const hiddenMcp = hqRoomMcpHidden(space?.mcpDeny)
    const where = [
      ...(repoPath ? [{ label: 'репо', value: repoPath }] : []),
      ...(fields.get('branch') ? [{ label: 'ветка', value: fields.get('branch') ?? '' }] : []),
      ...(fields.get('remote') ? [{ label: 'remote', value: fields.get('remote') ?? '' }] : []),
      ...(wiki !== null && repoPath ? [{ label: 'вики', value: `${repoPath}/wiki/index.md` }] : []),
      ...(artifacts !== null ? [{ label: 'артефакты', value: `HQ/artifacts/${project}/` }] : []),
      ...(space?.tasks || space?.messenger
        ? [{ label: 'задачи · люди', value: `${space.tasks ?? '—'} · ${space.messenger ?? '—'}` }]
        : []),
      // Custom build (hq-plus-room-mcp): so a chat knows why a system's tools are missing here.
      ...(hiddenMcp.length ? [{ label: 'MCP скрыты комнатой', value: hiddenMcp.join(', ') }] : [])
    ]
    const names = new Map(deps.pulse.listPeople().map((person) => [person.id, person.name]))
    return buildHqContextCard({
      project,
      // Why: synced pages head with «<slug> — what it is»; the card already starts with the slug.
      title: heading?.startsWith(`${project} — `) ? heading.slice(project.length + 3) : heading,
      status: fields.get('status') ?? null,
      roomName,
      autonomy: hqAutonomyFor(parseHqAutonomy(autonomyText), project),
      page:
        pageText === null
          ? null
          : { path: `HQ/${pagePath}`, syncedAt: Number.isNaN(synced) ? null : synced },
      plan:
        planFile === null
          ? null
          : {
              path: `HQ/${planFile.path}`,
              changedAt: planFile.changedAt,
              plan: parseHqPlan(planFile.text)
            },
      waitings: deps.pulse.listWaitings().filter((waiting) => same(waiting.project, project)),
      agreements: agreements(project),
      sessions: deps.pulse.listSessionsByProject(project),
      reports: deps.pulse.list({ kind: HQ_JOURNAL_KIND.chatReport, project, limit: 3 }),
      personName: (id) => (id ? (names.get(id) ?? null) : null),
      where,
      now: deps.now()
    })
  }

  return {
    async context(caller, requested) {
      const started = deps.now()
      const { project, room, roomName, sources } = await resolve(caller, requested)
      const lines = await card(project, roomName, sources)
      return { project, room, roomName, lines, ms: deps.now() - started }
    },

    async sessionStart(caller) {
      if (!deps.enabled() || !deps.hqPath()) {
        return { text: '', project: null, room: null }
      }
      const sources = await deps.sources()
      const scope = hqCallerScope(sources, caller)
      if (scope.kind === 'overview') {
        return { text: '', project: null, room: null }
      }
      const room = scope.room === HQ_JOURNAL_UNASSIGNED ? null : scope.room
      const notes = room
        ? ((await readText(join(hq(), HQ_SPACES_DIR, room, HQ_ROOM_CONTEXT_FILE))) ?? '')
            .trim()
            .split('\n')
        : []
      const roomName = room
        ? (sources.spaces.find((space) => space.slug === room)?.name ?? room)
        : null
      const projectCard = scope.project
        ? await card(scope.project, roomName, sources).catch(() => [])
        : []
      const text = hqSessionStartText(
        notes,
        projectCard,
        `HQ/${HQ_SPACES_DIR}/${room}/${HQ_ROOM_CONTEXT_FILE}`
      )
      return { text, project: scope.project, room }
    },

    async step(caller, input) {
      const { project, room } = await resolve(caller, input.project)
      const file = await findHqPlanFile(hq(), project)
      if (!file) {
        throw new Error(`HQ has no plan for ${project} in ${HQ_PLANS_DIR}/.`)
      }
      const step = parseHqPlan(file.text).steps.find((candidate) => candidate.id === input.id)
      const next = setHqPlanStep(file.text, input.id, input.done)
      if (!step || next === null) {
        throw new Error(`No step ${input.id} in ${file.path}.`)
      }
      const changed = next !== file.text
      if (changed) {
        await writeFile(join(hq(), file.path), next)
      }
      deps.pulse.record([
        {
          workspace: room ?? HQ_JOURNAL_UNASSIGNED,
          kind: HQ_CONTEXT_KIND.planStep,
          project,
          address: null,
          sessionId: caller.sessionId ?? null,
          personId: null,
          title: `${input.done ? 'Шаг сделан' : 'Шаг снова открыт'}: ${step.id} ${step.title}`,
          needs: 'nobody',
          status: 'done',
          replyTo: null,
          refKind: 'file',
          refId: file.path,
          links: [{ kind: 'file', id: file.path }],
          source: 'plan-step',
          dedupeKey: null
        }
      ])
      return { project, step: { ...step, done: input.done }, changed }
    },

    async where(question) {
      const text = await readText(join(hq(), HQ_WHERE_FILE))
      if (text === null) {
        throw new Error(`HQ has no ${HQ_WHERE_FILE} yet.`)
      }
      return { answers: matchHqWhere(text, question), file: `HQ/${HQ_WHERE_FILE}` }
    },

    async addRoom(input) {
      const added = await addHqRoom(hq(), input)
      if (deps.enabled()) {
        deps.pulse.record([hqRoomAddedEntry(added, input.name.trim())])
      }
      return added
    }
  }
}

let provided: HqContextService | null = null

export function provideHqContext(service: HqContextService | null): void {
  provided = service
}

export function getHqContext(): HqContextService | null {
  return provided
}
