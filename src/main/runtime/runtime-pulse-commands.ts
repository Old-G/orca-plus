// Custom build (pulse): the runtime face of orca-plus-pulse.db for the pulse.* RPC. The database
// opens on first use, so a user who never touches these features never gets the file.
import type {
  PulseAddResult,
  PulseDecision,
  PulseDecisionInput,
  PulseDraft,
  PulseDraftInput,
  PulseDraftStatus,
  PulseEvent,
  PulseInboxInput,
  PulseInboxItem,
  PulsePerson,
  PulsePersonInput,
  PulseWaiting,
  PulseWaitingFilter,
  PulseWaitingInput,
  PulseWaitingStatus
} from '../../shared/pulse-types'
import { getAppEnvironment } from '../../shared/app-environment'
import { PulseDb, pulseDbPath } from '../orca-plus/pulse/pulse-db'

export type PulseSnapshot = {
  people: PulsePerson[]
  waitings: PulseWaiting[]
  drafts: PulseDraft[]
  decisions: PulseDecision[]
  inbox: PulseInboxItem[]
  /** Read events after this seq to stay current. */
  latestSeq: number
}

const SNAPSHOT_DECISIONS = 20

export class RuntimePulseCommands {
  private opened: PulseDb | null = null

  constructor(
    private readonly open: () => PulseDb = () =>
      new PulseDb(pulseDbPath(getAppEnvironment().getPath('userData')))
  ) {}

  private db(): PulseDb {
    this.opened ??= this.open()
    return this.opened
  }

  /** Everything a view needs to start, in one read; open items only. */
  pulseSnapshot(): PulseSnapshot {
    const db = this.db()
    return {
      people: db.listPeople(),
      waitings: db.listWaitings({ status: 'open' }),
      drafts: db.listDrafts('pending'),
      decisions: db.listDecisions({ limit: SNAPSHOT_DECISIONS }),
      inbox: db.listInbox(),
      latestSeq: db.latestEventSeq()
    }
  }

  pulseEvents(afterSeq = 0, limit?: number): { events: PulseEvent[]; latestSeq: number } {
    const db = this.db()
    return { events: db.listEventsSince(afterSeq, limit), latestSeq: db.latestEventSeq() }
  }

  pulseUpsertPerson(input: PulsePersonInput): PulsePerson {
    return this.db().upsertPerson(input)
  }

  pulseListPeople(query?: string): PulsePerson[] {
    return this.db().listPeople(query)
  }

  pulseAddWaiting(input: PulseWaitingInput): PulseWaiting {
    return this.db().addWaiting(input)
  }

  pulseCloseWaiting(
    id: string,
    status: Exclude<PulseWaitingStatus, 'open'>,
    resolution?: string
  ): PulseWaiting {
    return this.db().closeWaiting(id, status, resolution)
  }

  pulseListWaitings(filter?: PulseWaitingFilter): PulseWaiting[] {
    return this.db().listWaitings(filter)
  }

  pulseAddDraft(input: PulseDraftInput): PulseAddResult<PulseDraft> {
    return this.db().addDraft(input)
  }

  pulseListDrafts(status?: PulseDraftStatus): PulseDraft[] {
    return this.db().listDrafts(status)
  }

  pulseLogDecision(input: PulseDecisionInput): PulseDecision {
    return this.db().logDecision(input)
  }

  pulseListDecisions(limit?: number): PulseDecision[] {
    return this.db().listDecisions({ limit })
  }

  pulseAddInboxItem(input: PulseInboxInput): PulseAddResult<PulseInboxItem> {
    return this.db().addInboxItem(input)
  }

  pulseListInbox(includeDone?: boolean): PulseInboxItem[] {
    return this.db().listInbox({ includeDone })
  }

  pulseMarkInboxRead(id: string): PulseInboxItem {
    return this.db().markInboxRead(id)
  }

  pulseMarkInboxDone(id: string, action?: string): PulseInboxItem {
    return this.db().markInboxDone(id, action)
  }
}
