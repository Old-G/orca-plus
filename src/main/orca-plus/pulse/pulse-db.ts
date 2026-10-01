// Custom build (pulse): orca-plus-pulse.db — one entry point over the record modules, for the
// RPC, the CLI and the HQ mirror to share.
import { join } from 'node:path'
import type {
  PulseApprovalOutcome,
  PulseDecisionInput,
  PulseDraftInput,
  PulseDraftStatus,
  PulseInboxInput,
  PulsePersonInput,
  PulseWaitingFilter,
  PulseWaitingInput,
  PulseWaitingStatus
} from '../../../shared/pulse-types'
import { PulseCore, type PulseClock } from './pulse-core'
import {
  decideDraft,
  listDecisions,
  logDecision,
  setDecisionMirror,
  type PulseDecisionListOptions
} from './pulse-decisions'
import { abandonDraft, addDraft, getDraft, listDrafts, markDraftDelivery } from './pulse-drafts'
import { latestEventSeq, listEventsSince, pruneEvents } from './pulse-events'
import {
  addInboxItem,
  getInboxItem,
  listInbox,
  markInboxDone,
  markInboxRead,
  syncInboxKind
} from './pulse-inbox'
import { getPerson, listPeople, upsertPerson } from './pulse-people'
import { addWaiting, closeWaiting, getWaiting, listWaitings } from './pulse-waitings'

export const PULSE_DB_FILE = 'orca-plus-pulse.db'

export function pulseDbPath(userDataPath: string): string {
  return join(userDataPath, PULSE_DB_FILE)
}

export class PulseDb {
  private readonly core: PulseCore

  constructor(path: (string & {}) | ':memory:', clock: Partial<PulseClock> = {}) {
    this.core = new PulseCore(path, clock)
  }

  upsertPerson(input: PulsePersonInput) {
    return upsertPerson(this.core, input)
  }
  getPerson(id: string) {
    return getPerson(this.core, id)
  }
  listPeople(query?: string) {
    return listPeople(this.core, query)
  }

  addWaiting(input: PulseWaitingInput) {
    return addWaiting(this.core, input)
  }
  getWaiting(id: string) {
    return getWaiting(this.core, id)
  }
  closeWaiting(id: string, status: Exclude<PulseWaitingStatus, 'open'>, resolution?: string) {
    return closeWaiting(this.core, id, status, resolution)
  }
  listWaitings(filter?: PulseWaitingFilter) {
    return listWaitings(this.core, filter)
  }

  addDraft(input: PulseDraftInput) {
    return addDraft(this.core, input)
  }
  getDraft(id: string) {
    return getDraft(this.core, id)
  }
  listDrafts(status?: PulseDraftStatus) {
    return listDrafts(this.core, status)
  }
  decideDraft(id: string, outcome: PulseApprovalOutcome, editedBody?: string) {
    return decideDraft(this.core, id, outcome, editedBody)
  }
  markDraftDelivery(id: string, status: 'sent' | 'failed') {
    return markDraftDelivery(this.core, id, status)
  }
  abandonDraft(id: string) {
    return abandonDraft(this.core, id)
  }

  logDecision(input: PulseDecisionInput) {
    return logDecision(this.core, input)
  }
  listDecisions(options?: PulseDecisionListOptions) {
    return listDecisions(this.core, options)
  }
  setDecisionMirror(id: string, path: string) {
    setDecisionMirror(this.core, id, path)
  }

  addInboxItem(input: PulseInboxInput) {
    return addInboxItem(this.core, input)
  }
  getInboxItem(id: string) {
    return getInboxItem(this.core, id)
  }
  listInbox(options?: { includeDone?: boolean }) {
    return listInbox(this.core, options)
  }
  markInboxRead(id: string) {
    return markInboxRead(this.core, id)
  }
  markInboxDone(id: string, action?: string) {
    return markInboxDone(this.core, id, action)
  }
  syncInboxKind(kind: string, desired: readonly (PulseInboxInput & { dedupeKey: string })[]) {
    return syncInboxKind(this.core, kind, desired)
  }

  listEventsSince(afterSeq: number, limit?: number) {
    return listEventsSince(this.core, afterSeq, limit)
  }
  latestEventSeq() {
    return latestEventSeq(this.core)
  }
  pruneEvents(beforeAt: number) {
    return pruneEvents(this.core, beforeAt)
  }

  close(): void {
    this.core.close()
  }
}
