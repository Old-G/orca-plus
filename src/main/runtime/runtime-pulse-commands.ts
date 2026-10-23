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
  PulseWaitingAdded,
  PulseWaitingInput,
  PulseWaitingPatch,
  PulseWaitingReply,
  PulseWaitingStatus
} from '../../shared/pulse-types'
import { getAppEnvironment } from '../../shared/app-environment'
import type { HqFeedItem, HqFeedQuery } from '../../shared/hq-feed'
import type {
  HqJournalEntry,
  HqJournalInput,
  HqJournalQuery,
  HqJournalRecordResult,
  HqSession,
  HqSessionInput
} from '../../shared/hq-journal'
import { PulseDb, pulseDbPath } from '../orca-plus/pulse/pulse-db'
import { withLegacySentContext } from '../orca-plus/outgoing-approval/outgoing-sent-history'
import { OUTGOING_APPROVAL_BELL_KIND } from '../../shared/outgoing-approval/outgoing-approval-bell'

export type PulseSnapshot = {
  people: PulsePerson[]
  waitings: PulseWaiting[]
  drafts: PulseDraft[]
  decisions: PulseDecision[]
  inbox: PulseInboxItem[]
  /** Read events after this seq to stay current. */
  latestSeq: number
}

// Why: HQ's «Done for you» shows a week of what was sent; 20 ran out within a busy day.
const SNAPSHOT_DECISIONS = 100
// Custom build (hq-feed): two months of the feed; older rows add nothing a search needs.
const FEED_KEEP_MS = 60 * 24 * 60 * 60_000

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
      // Custom build (hq-sent-history): older approvals get where they went from their card.
      decisions: withLegacySentContext(db.listDecisions({ limit: SNAPSHOT_DECISIONS }), {
        getDraft: (id) => db.getDraft(id),
        approvalCards: (since) =>
          db.listInbox({ includeDone: true, kind: OUTGOING_APPROVAL_BELL_KIND, since })
      }),
      inbox: db.listInbox(),
      latestSeq: db.latestEventSeq()
    }
  }

  pulseEvents(afterSeq = 0, limit?: number): { events: PulseEvent[]; latestSeq: number } {
    const db = this.db()
    return { events: db.listEventsSince(afterSeq, limit), latestSeq: db.latestEventSeq() }
  }

  /** Custom build (hq-feed): HQ's feed, newest first. */
  pulseFeed(query?: HqFeedQuery): { items: HqFeedItem[] } {
    return { items: this.db().listFeed(query) }
  }

  /** Custom build (hq-feed-posts): work-done rows still waiting for their post. */
  pulseFeedWithoutPost(limit: number): HqFeedItem[] {
    return this.db().listFeedWithoutPost(limit)
  }

  pulseSetFeedPosts(posts: ReadonlyMap<string, string>): void {
    this.db().setFeedPosts(posts)
  }

  /** Custom build (hq-feed): what the feed collector found; old rows go after FEED_KEEP_MS. */
  pulseUpsertFeed(items: readonly HqFeedItem[]): number {
    const db = this.db()
    db.pruneFeed(Date.now() - FEED_KEEP_MS)
    return db.upsertFeed(items)
  }

  pulseUpsertPerson(input: PulsePersonInput): PulsePerson {
    return this.db().upsertPerson(input)
  }

  pulseListPeople(query?: string): PulsePerson[] {
    return this.db().listPeople(query)
  }

  pulseAddWaiting(input: PulseWaitingInput): PulseWaitingAdded {
    return this.db().addWaiting(input)
  }

  pulseUpdateWaiting(id: string, patch: PulseWaitingPatch): PulseWaiting {
    return this.db().updateWaiting(id, patch)
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

  /** Custom build (hq-waiting-replies): main's reply relay only; no RPC method reaches these. */
  pulseRecordWaitingReply(id: string, reply: PulseWaitingReply): PulseWaiting | null {
    return this.db().recordWaitingReply(id, reply)
  }

  pulseMarkWaitingReplyDelivered(id: string, replyTs?: string): PulseWaiting | null {
    return this.db().markWaitingReplyDelivered(id, replyTs)
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

  pulseListInbox(
    includeDone?: boolean,
    filter: { kind?: string; since?: number } = {}
  ): PulseInboxItem[] {
    return this.db().listInbox({ includeDone, ...filter })
  }

  pulseMarkInboxRead(id: string): PulseInboxItem {
    return this.db().markInboxRead(id)
  }

  pulseMarkInboxDone(id: string, action?: string): PulseInboxItem {
    return this.db().markInboxDone(id, action)
  }

  /** Custom build (hq-plus-journal): main's journal adapters write here; agents read via hq.events. */
  pulseRecordJournal(inputs: readonly HqJournalInput[]): HqJournalRecordResult {
    return this.db().recordJournal(inputs)
  }

  pulseListJournal(query?: HqJournalQuery): HqJournalEntry[] {
    return this.db().listJournal(query)
  }

  pulseGetJournalEntry(id: string): HqJournalEntry | null {
    return this.db().getJournalEntry(id)
  }

  pulseNoteSessions(inputs: readonly HqSessionInput[]): number {
    return this.db().noteSessions(inputs)
  }

  pulseGetSession(sessionId: string): HqSession | null {
    return this.db().getSession(sessionId)
  }

  pulseListSessionsByAddress(address: string): HqSession[] {
    return this.db().listSessionsByAddress(address)
  }

  /** Custom build (hq-plus-context) */
  pulseListSessionsByProject(project: string): HqSession[] {
    return this.db().listSessionsByProject(project)
  }

  /** Custom build (pulse-bell): see syncInboxKind. */
  pulseSyncInboxKind(
    kind: string,
    desired: readonly (PulseInboxInput & { dedupeKey: string })[]
  ): { raised: number; closed: number } {
    return this.db().syncInboxKind(kind, desired)
  }
}
