// Custom build (hq-closed-loop): background work reports into the journal the way a chat reports a
// turn — what the job found, what it asks the owner (his move, with the options to pick), what it did
// by itself. One thread per job (`job/<name>`); a newer report settles the job's older open question.
import {
  HQ_JOURNAL_KIND,
  hqJournalTitle,
  type HqJournalEntry,
  type HqJournalInput
} from '../../shared/hq-journal'
import { hqJournalLink, journalEntryAsInput } from './hq-journal-adapters'

export type HqJobInput = {
  job: string
  found?: string
  ask?: string
  options?: string[]
  did?: string
  learned?: string
  links?: string[]
  project?: string
}

export const HQ_JOB_SOURCE_PREFIX = 'job:'

export function hqJobAddress(job: string): string {
  return `job/${job}`
}

/** The journal row of one report; `place` is the project's room, or every room's when it has none. */
export function hqJobRow(
  input: HqJobInput,
  place: { room: string; project: string | null; firm: boolean },
  at: number
): HqJournalInput {
  const options = input.options?.map((option) => option.trim()).filter(Boolean) ?? []
  const body = [
    input.found ? `Found: ${input.found}` : null,
    input.ask
      ? `Question: ${input.ask}${options.length > 0 ? ` (options: ${options.join(' | ')})` : ''}`
      : null,
    input.did ? `Did: ${input.did}` : null,
    input.learned ? `Learned: ${input.learned}` : null
  ]
    .filter((line): line is string => line !== null)
    .join('\n')
  const head = input.ask ?? input.learned ?? input.found ?? input.did ?? ''
  return {
    workspace: place.room,
    placement: place.firm ? 'firm' : 'fallback',
    kind: HQ_JOURNAL_KIND.jobReport,
    at,
    project: place.project,
    address: hqJobAddress(input.job),
    sessionId: null,
    personId: null,
    title: hqJournalTitle(`${input.job}: ${head}`),
    body,
    needs: input.ask ? 'owner:decide' : 'nobody',
    status: input.ask ? 'open' : 'done',
    replyTo: null,
    refKind: 'job',
    refId: input.job,
    links: (input.links ?? []).flatMap((link) => hqJournalLink(link)),
    source: `${HQ_JOB_SOURCE_PREFIX}${input.job}`,
    dedupeKey: `${HQ_JOB_SOURCE_PREFIX}${input.job}:${at}`,
    // Why: the job's newer run answers for it; its older open question is no one's move now.
    supersedes: true
  }
}

export const HQ_JOB_REPLY_SOURCE = 'hq-plus-job-reply'

/** The owner's answer to a job's card: a message in the job's thread, which its next run reads
 *  (`orca hq thread job/<name>`), and the question settled. */
export function hqJobReplyRows(entry: HqJournalEntry, text: string, at: number): HqJournalInput[] {
  if (entry.kind !== HQ_JOURNAL_KIND.jobReport) {
    throw new Error(`${entry.id} is not a background job's report.`)
  }
  return [
    {
      workspace: entry.workspace,
      kind: HQ_JOURNAL_KIND.chatMessage,
      at,
      project: entry.project,
      address: entry.address,
      sessionId: null,
      personId: null,
      title: hqJournalTitle(`From HQ+: ${text}`),
      body: `> ${entry.title}\n\n${text}`,
      needs: entry.refId ? `agent:${hqJobAddress(entry.refId)}` : 'nobody',
      status: 'done',
      replyTo: entry.id,
      refKind: 'journal',
      refId: entry.id,
      source: HQ_JOB_REPLY_SOURCE,
      dedupeKey: `${HQ_JOB_REPLY_SOURCE}:${entry.id}:${at}`
    },
    ...(entry.status === 'open' && entry.dedupeKey
      ? [journalEntryAsInput(entry, { status: 'done' })]
      : [])
  ]
}
