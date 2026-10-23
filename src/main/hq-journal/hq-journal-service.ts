// Custom build (hq-plus-journal): keeps HQ+'s journal in step with what Orca+ already records, and
// answers `hq.events` / `hq.whoami` within the caller's room. Sources stay where they are; the
// journal points at them.
import {
  HQ_JOURNAL_ALL_ROOMS,
  HQ_JOURNAL_KIND,
  HQ_JOURNAL_NEEDS_PARTIES,
  HQ_JOURNAL_UNASSIGNED,
  isHqJournalNeeds,
  type HqEventsResult,
  type HqJournalEntry,
  type HqJournalHeader,
  type HqJournalQuery,
  type HqJournalRecordResult,
  type HqWhoami
} from '../../shared/hq-journal'
import { createDebouncedSingleFlight } from '../orca-plus/debounced-single-flight'
import { readHqSpacePlacing, type HqSpacePlacing } from '../hq-today/hq-spaces'
import { collectHqJournal, type HqJournalPulse } from './hq-journal-collect'
import {
  hqCallerScope,
  type HqCaller,
  type HqCallerScope,
  type HqRoomSources
} from './hq-journal-rooms'

const PLACING_TTL_MS = 60_000
const SYNC_DEBOUNCE_MS = 2_000
// Why: an agent asking right after something happened should see it without waiting for the timer.
const FRESH_MS = 30_000

export type HqJournalServiceDeps = {
  /** The owner's switch (Settings → Workspace); off, nothing new is written to the journal. */
  enabled: () => boolean
  hqPath: () => string | null
  repos: () => readonly { id: string; path: string; displayName: string }[]
  folderGroup: (folderWorkspaceId: string) => string | null
  sessionWorkspace: (sessionId: string) => string | null
  pulse: HqJournalPulse
  now: () => number
  log: (message: string) => void
}

export type HqEventsRequest = HqCaller & {
  since?: number
  project?: string
  needs?: string
  kind?: string
  limit?: number
  room?: string
}

export type HqJournalService = {
  /** The room the caller works in, by the spaces as last read. */
  scope: (caller: HqCaller) => Promise<HqCallerScope>
  schedule: () => void
  sync: () => Promise<HqJournalRecordResult>
  events: (request: HqEventsRequest) => Promise<HqEventsResult>
  whoami: (caller: HqCaller) => Promise<HqWhoami>
  dispose: () => void
}

function header(entry: HqJournalEntry): HqJournalHeader {
  return {
    id: entry.id,
    at: entry.at,
    workspace: entry.workspace,
    kind: entry.kind,
    project: entry.project,
    address: entry.address,
    title: entry.title,
    needs: entry.needs,
    status: entry.status
  }
}

function checkedNeeds(needs: string | undefined): string | undefined {
  if (
    needs === undefined ||
    HQ_JOURNAL_NEEDS_PARTIES.some((party) => party === needs) ||
    isHqJournalNeeds(needs)
  ) {
    return needs
  }
  throw new Error(`--needs takes ${HQ_JOURNAL_NEEDS_PARTIES.join(', ')} or one full value`)
}

export function createHqJournalService(deps: HqJournalServiceDeps): HqJournalService {
  let placing: { at: number; hqPath: string; value: HqSpacePlacing } | null = null
  let lastSync = 0

  // Why: a workspace file read mid-edit would misplace rows; the last complete read stands in.
  let placingComplete = true
  const sources = async (): Promise<HqRoomSources> => {
    const hqPath = deps.hqPath()
    const now = deps.now()
    if (!hqPath) {
      placingComplete = true
    }
    if (hqPath && (!placing || placing.hqPath !== hqPath || now - placing.at > PLACING_TTL_MS)) {
      const read = await readHqSpacePlacing(hqPath)
      placingComplete = read.complete
      if (read.complete || !placing || placing.hqPath !== hqPath) {
        placing = { at: now, hqPath, value: read }
      }
    }
    const value = hqPath && placing ? placing.value : null
    return {
      spaces: value?.spaces ?? [],
      groupRooms: value?.groupRooms ?? new Map(),
      projectOfRepo: value?.projectOfRepo ?? new Map(),
      defaultRoom: value?.defaultRoom ?? null,
      repos: deps.repos(),
      hqPath,
      folderGroup: deps.folderGroup,
      sessionWorkspace: deps.sessionWorkspace
    }
  }

  const syncOnce = async (): Promise<HqJournalRecordResult> => {
    if (!deps.enabled()) {
      return { added: 0, settled: 0, moved: 0 }
    }
    const now = deps.now()
    const roomSources = await sources()
    if (!placingComplete) {
      deps.log('journal sync waits: a workspace file or the project pages could not be read')
      return { added: 0, settled: 0, moved: 0 }
    }
    const { entries, sessions } = await collectHqJournal(deps.pulse, roomSources, now)
    deps.pulse.noteSessions(sessions)
    const result = deps.pulse.record(entries)
    lastSync = now
    if (result.added > 0 || result.settled > 0 || result.moved > 0) {
      deps.log(`journal: ${result.added} added, ${result.settled} settled, ${result.moved} moved`)
    }
    return result
  }

  const flight = createDebouncedSingleFlight(
    syncOnce,
    (error) => {
      deps.log(`journal sync failed: ${error instanceof Error ? error.message : String(error)}`)
      return { added: 0, settled: 0, moved: 0 }
    },
    SYNC_DEBOUNCE_MS
  )

  const fresh = async (): Promise<void> => {
    if (deps.now() - lastSync > FRESH_MS) {
      await flight.runNow()
    }
  }

  const roomName = (roomSources: HqRoomSources, room: string): string | null =>
    roomSources.spaces.find((space) => space.slug === room)?.name ?? null

  const scopeOf = async (
    caller: HqCaller
  ): Promise<{ scope: HqCallerScope; roomSources: HqRoomSources }> => {
    const roomSources = await sources()
    return { scope: hqCallerScope(roomSources, caller), roomSources }
  }

  return {
    scope: async (caller) => (await scopeOf(caller)).scope,
    schedule: () => flight.schedule(),
    sync: () => flight.runNow(),
    dispose: () => flight.dispose(),

    async events(request) {
      await fresh()
      const { scope, roomSources } = await scopeOf(request)
      const needs = checkedNeeds(request.needs)
      const query: HqJournalQuery = {
        since: request.since,
        project: request.project,
        needs,
        // Why: a settled row is nobody's move any more, whoever it once waited on.
        status: needs && needs !== 'nobody' ? 'open' : undefined,
        kind: request.kind,
        limit: request.limit
      }
      if (scope.kind === 'overview' && !request.room) {
        return { scope: 'overview', headers: deps.pulse.list(query).map(header) }
      }
      if (scope.kind === 'room' && request.room && request.room !== scope.room) {
        throw new Error(
          `This chat works in room ${scope.room}; only HQ+ reads another room's entries.`
        )
      }
      const room = request.room ?? (scope.kind === 'room' ? scope.room : HQ_JOURNAL_UNASSIGNED)
      const known = [
        HQ_JOURNAL_ALL_ROOMS,
        HQ_JOURNAL_UNASSIGNED,
        ...roomSources.spaces.map((space) => space.slug)
      ]
      if (!known.includes(room)) {
        throw new Error(`No room ${room}; rooms: ${known.join(', ')}`)
      }
      if (scope.kind === 'overview' && deps.enabled()) {
        // Why: HQ+ reading one room in full is itself an event the owner can look back on.
        deps.pulse.record([
          {
            workspace: HQ_JOURNAL_ALL_ROOMS,
            kind: HQ_JOURNAL_KIND.crossRead,
            project: null,
            address: null,
            sessionId: scope.sessionId,
            personId: null,
            title: `HQ+ read room ${room}`,
            body: JSON.stringify({ ...query, room }),
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
      return {
        scope: 'room',
        room,
        roomName: roomName(roomSources, room),
        entries: deps.pulse.list({ ...query, workspaces: [room] })
      }
    },

    async whoami(caller) {
      const { scope, roomSources } = await scopeOf(caller)
      const session = scope.sessionId ? deps.pulse.getSession(scope.sessionId) : null
      const room = scope.kind === 'room' ? scope.room : null
      return {
        sessionId: scope.sessionId,
        overview: scope.kind === 'overview',
        room,
        roomName: room ? roomName(roomSources, room) : null,
        project: scope.kind === 'room' ? (scope.project ?? session?.project ?? null) : null,
        address: session?.address ?? null,
        task: session?.taskRef ?? null,
        worktreeId: scope.worktreeId
      }
    }
  }
}

let provided: HqJournalService | null = null

/** The running app's journal, for the runtime RPC. */
export function provideHqJournalService(service: HqJournalService | null): void {
  provided = service
}

export function getHqJournalService(): HqJournalService | null {
  return provided
}
