// Custom build (hq-plus-reports): threads — every chat working on one `<project>/<task>` address and
// what was said there. A chat reports its turn (`orca hq report`), reads a thread (`orca hq
// thread`), and hands a message to another chat's thread (`orca chat send`), with the quote of
// what it answers. A handoff keeps the address, so the next chat continues the same thread.
import {
  HQ_JOURNAL_ALL_ROOMS,
  HQ_JOURNAL_KIND,
  HQ_JOURNAL_MAX_LIMIT,
  HQ_JOURNAL_REPORT_SOURCE,
  hqJournalTitle,
  hqThreadAddress,
  isHqThreadAddress,
  type HqChatSendResult,
  type HqJournalEntry,
  type HqJournalInput,
  type HqReportInput,
  type HqReportResult,
  type HqSession,
  type HqThreadResult
} from '../../shared/hq-journal'
import { HQ_ROUTING_KIND, type HqSettleResult } from '../../shared/hq-routing'
import type { PulsePerson, PulsePersonInput } from '../../shared/pulse-types'
import { hqJournalLink, journalEntryAsInput } from './hq-journal-adapters'
import type { HqJournalPulse } from './hq-journal-collect'
import type { HqCaller, HqCallerScope } from './hq-journal-rooms'

const SEND_SOURCE = 'chat-send'
// Why: a reopened chat takes a moment to attach its session before it can take a turn.
const REOPEN_TRIES = 15
const REOPEN_STEP_MS = 1_000

export type HqThreadsDeps = {
  enabled: () => boolean
  scope: (caller: HqCaller) => Promise<HqCallerScope>
  pulse: Pick<HqJournalPulse, 'record' | 'list' | 'getSession' | 'noteSessions'> & {
    listSessionsByAddress: (address: string) => HqSession[]
    getEntry: (id: string) => HqJournalEntry | null
    listPeople: () => PulsePerson[]
    upsertPerson: (input: PulsePersonInput) => PulsePerson
  }
  /** The chat's name, as its tab shows it. */
  sessionName: (sessionId: string) => string | null
  sessionWorkspace: (sessionId: string) => string | null
  /** True once the native chat took the turn, sent or queued. */
  deliver: (sessionId: string, prompt: string) => Promise<boolean>
  /** Asks the Orca+ window to bring a closed chat back; false when no window can. */
  reopen: (sessionId: string, worktreeId: string) => boolean
  wait: (ms: number) => Promise<void>
  now: () => number
}

export type HqThreads = {
  report: (caller: HqCaller, input: HqReportInput) => Promise<HqReportResult>
  thread: (caller: HqCaller, address?: string) => Promise<HqThreadResult>
  send: (
    caller: HqCaller,
    message: { address: string; text: string; replyTo?: string }
  ) => Promise<HqChatSendResult>
  /** A handoff's new chat takes over the old one's thread. */
  handoff: (fromSessionId: string, toSessionId: string) => void
  /** Custom build (hq-plus-routing): a chat closes an open row it was handed, with why. */
  settle: (caller: HqCaller, input: HqSettleInput) => Promise<HqSettleResult>
}

export type HqSettleInput = {
  id: string
  status: 'done' | 'dropped'
  commit?: string
  why?: string
}

const SETTLE_SOURCE = 'chat-settle'
const COMMIT = /^[0-9a-f]{7,40}$/

const JOURNAL_OFF = 'The HQ+ journal is off (Settings → Workspace → HQ+ journal).'

function stamp(at: number): string {
  const date = new Date(at)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function roomOf(scope: HqCallerScope): string {
  return scope.kind === 'room' ? scope.room : HQ_JOURNAL_ALL_ROOMS
}

/** A room's chat sees its room only; HQ+ sees every room. */
const HQ_JOB_THREAD_PREFIX = 'job/'

function visible(scope: HqCallerScope, workspace: string): boolean {
  return scope.kind === 'overview' || scope.room === workspace
}

export function createHqThreads(deps: HqThreadsDeps): HqThreads {
  const latest = (query: { sessionId?: string; address?: string; source: string }) =>
    deps.pulse.list({ ...query, limit: 1 })[0] ?? null

  /** `person:<id>` for a name or id, adding the person when the name is new. */
  const personNeeds = (value: string): string => {
    const wanted = value.replace(/^person:/, '').trim()
    const people = deps.pulse.listPeople()
    const found =
      people.find((person) => person.id === wanted) ??
      people.find((person) => person.name.toLowerCase() === wanted.toLowerCase())
    return `person:${(found ?? deps.pulse.upsertPerson({ name: wanted })).id}`
  }

  const addressFor = (scope: HqCallerScope, sessionId: string, asked?: string): string => {
    if (asked) {
      if (!isHqThreadAddress(asked)) {
        throw new Error(`--address takes <project>/<task> in lower-case latin, got "${asked}"`)
      }
      return asked
    }
    const session = deps.pulse.getSession(sessionId)
    const known = session?.address
    const project = scope.kind === 'room' ? (scope.project ?? session?.project ?? null) : 'hq'
    return (
      known ??
      hqThreadAddress(project, deps.sessionName(sessionId) ?? sessionId.slice(-8)) ??
      `${project ?? 'chat'}/${sessionId.slice(-8).toLowerCase()}`
    )
  }

  return {
    async report(caller, input) {
      if (!deps.enabled()) {
        throw new Error(JOURNAL_OFF)
      }
      const scope = await deps.scope(caller)
      const sessionId = scope.sessionId
      if (!sessionId) {
        throw new Error('orca hq report runs inside an Orca chat; this shell has no chat session.')
      }
      const address = addressFor(scope, sessionId, input.address)
      const needs = input.ask
        ? 'owner:decide'
        : input.blockedBy
          ? personNeeds(input.blockedBy)
          : 'nobody'
      const options = input.options?.filter((option) => option.trim()) ?? []
      const body = [
        `Done: ${input.done}`,
        input.ask
          ? `Question: ${input.ask}${options.length > 0 ? ` (options: ${options.join(' | ')})` : ''}`
          : null,
        input.next ? `Next: ${input.next}` : null,
        input.blockedBy ? `Waiting on: ${input.blockedBy.replace(/^person:/, '')}` : null
      ]
        .filter((line): line is string => line !== null)
        .join('\n')
      const at = deps.now()
      const workspace = roomOf(scope)
      const project = scope.kind === 'room' ? scope.project : null
      deps.pulse.noteSessions([
        {
          sessionId,
          address,
          agent: null,
          worktreeId: scope.worktreeId,
          workspace,
          project,
          state: needs === 'nobody' ? 'done' : 'waiting',
          contextPct: null,
          parentSessionId: null,
          taskRef: null,
          at
        }
      ])
      const row: HqJournalInput = {
        workspace,
        placement: 'firm',
        kind: HQ_JOURNAL_KIND.chatReport,
        at,
        project,
        address,
        sessionId,
        personId: needs.startsWith('person:') ? needs.slice('person:'.length) : null,
        title: hqJournalTitle(input.ask ? `${input.done} — ${input.ask}` : input.done),
        body,
        needs,
        status: needs === 'nobody' ? 'done' : 'open',
        replyTo: null,
        refKind: 'session',
        refId: sessionId,
        links: (input.links ?? []).flatMap((link) => hqJournalLink(link)),
        source: HQ_JOURNAL_REPORT_SOURCE,
        dedupeKey: `${HQ_JOURNAL_REPORT_SOURCE}:${sessionId}:${at}`,
        // Why: a chat's newer report answers for it; its older open question is no one's move now.
        supersedes: true
      }
      deps.pulse.record([row])
      const entry = latest({ sessionId, source: HQ_JOURNAL_REPORT_SOURCE })
      if (!entry) {
        throw new Error('The report was not recorded.')
      }
      return { entry, address }
    },

    async thread(caller, asked) {
      const scope = await deps.scope(caller)
      const own = scope.sessionId ? deps.pulse.getSession(scope.sessionId)?.address : null
      const address = asked ?? own
      if (!address) {
        throw new Error('This chat has no thread yet; its first `orca hq report` names one.')
      }
      // Custom build (hq-closed-loop): a background job (no chat) reads its own thread from any room.
      // Why: only a caller of no chat, workspace or project (a launchd script); a terminal in a project keeps its room.
      const unplaced =
        !scope.sessionId && !scope.worktreeId && (scope.kind === 'overview' || !scope.project)
      const jobReads = unplaced && address.startsWith(HQ_JOB_THREAD_PREFIX)
      const seen = (workspace: string): boolean => jobReads || visible(scope, workspace)
      const entries = deps.pulse
        .list({ address, oldestFirst: true, limit: HQ_JOURNAL_MAX_LIMIT })
        .filter((entry) => seen(entry.workspace))
      const sessions = deps.pulse
        .listSessionsByAddress(address)
        .filter((session) => seen(session.workspace))
      if (entries.length === 0 && sessions.length === 0) {
        throw new Error(`No thread ${address} in this chat's room.`)
      }
      return { address, entries, sessions }
    },

    async send(caller, message) {
      if (!deps.enabled()) {
        throw new Error(JOURNAL_OFF)
      }
      const scope = await deps.scope(caller)
      const target = deps.pulse
        .listSessionsByAddress(message.address)
        .find((session) => visible(scope, session.workspace))
      if (!target) {
        throw new Error(
          `No chat works on ${message.address} in this chat's room; \`orca hq events\` lists the threads.`
        )
      }
      const quoted = message.replyTo ? deps.pulse.getEntry(message.replyTo) : null
      if (message.replyTo && (!quoted || !visible(scope, quoted.workspace))) {
        throw new Error(`No journal entry ${message.replyTo} in this chat's room.`)
      }
      const from =
        (scope.sessionId ? deps.pulse.getSession(scope.sessionId)?.address : null) ??
        (scope.kind === 'overview' ? 'HQ+' : 'another chat')
      const head = quoted
        ? `Orca+ · a message from thread ${from}, in reply to «${quoted.title}» (${stamp(quoted.at)}):`
        : `Orca+ · a message from thread ${from}:`
      const prompt = [head, '"""', message.text, '"""'].join('\n')
      let reopened = false
      let taken = await deps.deliver(target.sessionId, prompt)
      const worktreeId = target.worktreeId ?? deps.sessionWorkspace(target.sessionId)
      if (!taken && worktreeId && deps.reopen(target.sessionId, worktreeId)) {
        reopened = true
        for (let tries = 0; tries < REOPEN_TRIES && !taken; tries += 1) {
          await deps.wait(REOPEN_STEP_MS)
          taken = await deps.deliver(target.sessionId, prompt)
        }
      }
      if (!taken) {
        throw new Error(
          `The chat on ${message.address} is closed and Orca+ could not bring it back; open it from History and send again.`
        )
      }
      // Why: the owner's answer is the owner's move; left open, the question still counts as waiting.
      const ownerAnswers =
        quoted !== null &&
        scope.kind === 'overview' &&
        !scope.sessionId &&
        quoted.status === 'open' &&
        quoted.needs.startsWith('owner:') &&
        quoted.dedupeKey !== null
      deps.pulse.record([
        {
          workspace: target.workspace,
          kind: HQ_JOURNAL_KIND.chatMessage,
          at: deps.now(),
          project: target.project,
          address: message.address,
          sessionId: target.sessionId,
          personId: null,
          title: hqJournalTitle(`From ${from}: ${message.text}`),
          body: quoted ? `> ${quoted.title}\n\n${message.text}` : message.text,
          needs: `agent:${message.address}`,
          status: 'done',
          replyTo: quoted?.id ?? null,
          refKind: 'session',
          refId: target.sessionId,
          source: SEND_SOURCE,
          dedupeKey: null
        },
        ...(ownerAnswers ? [journalEntryAsInput(quoted, { status: 'done' })] : [])
      ])
      const entry = latest({ address: message.address, source: SEND_SOURCE })
      if (!entry) {
        throw new Error('The message was delivered but not recorded.')
      }
      return { entry, sessionId: target.sessionId, reopened }
    },

    async settle(caller, input) {
      if (!deps.enabled()) {
        throw new Error(JOURNAL_OFF)
      }
      const scope = await deps.scope(caller)
      const entry = deps.pulse.getEntry(input.id)
      if (!entry || !visible(scope, entry.workspace)) {
        throw new Error(`No journal entry ${input.id} in this chat's room.`)
      }
      if (input.commit && !COMMIT.test(input.commit)) {
        throw new Error(`--commit takes a commit sha, got "${input.commit}"`)
      }
      if (input.status === 'dropped' && !input.why?.trim()) {
        throw new Error('--dropped needs --why: one line on why it needs no fix')
      }
      // Custom build (hq-fix-now-all): a minor finding is noted done by its source; once «Fix now»
      // handed it to a chat, that chat still closes it with its verdict — once.
      const handedMinor =
        entry.kind === HQ_JOURNAL_KIND.reviewFinding &&
        entry.address !== null &&
        !deps.pulse
          .list({
            kind: HQ_ROUTING_KIND.settled,
            address: entry.address,
            limit: HQ_JOURNAL_MAX_LIMIT
          })
          .some((row) => row.refId === entry.id)
      if (entry.status !== 'open' && !handedMinor) {
        return { settled: false, entryId: entry.id, status: input.status }
      }
      if (!entry.dedupeKey) {
        throw new Error(`${entry.id} is closed by its own source, not by a chat.`)
      }
      const address =
        entry.address ??
        (scope.sessionId ? (deps.pulse.getSession(scope.sessionId)?.address ?? null) : null)
      const outcome = input.status === 'done' ? 'Fixed' : 'No fix needed'
      deps.pulse.record([
        journalEntryAsInput(entry, { status: input.status }),
        {
          workspace: entry.workspace,
          kind: HQ_ROUTING_KIND.settled,
          at: deps.now(),
          project: entry.project,
          address,
          sessionId: scope.sessionId,
          personId: null,
          title: hqJournalTitle(
            `${outcome}: ${entry.title}${input.commit ? ` (${input.commit.slice(0, 10)})` : ''}`
          ),
          body: input.why?.trim() || null,
          needs: 'nobody',
          status: 'done',
          replyTo: entry.id,
          refKind: 'journal',
          refId: entry.id,
          links: input.commit ? [{ kind: 'commit', id: input.commit }] : [],
          source: SETTLE_SOURCE,
          dedupeKey: `${HQ_ROUTING_KIND.settled}:${entry.id}`
        }
      ])
      return { settled: true, entryId: entry.id, status: input.status }
    },

    handoff(fromSessionId, toSessionId) {
      const from = deps.pulse.getSession(fromSessionId)
      if (!from?.address || !deps.enabled()) {
        return
      }
      const at = deps.now()
      deps.pulse.noteSessions([
        { ...from, sessionId: toSessionId, parentSessionId: fromSessionId, state: 'working', at }
      ])
      // Why: the new chat carries the old one's open questions; they are no longer the owner's move there.
      const asked = deps.pulse
        .list({
          sessionId: fromSessionId,
          needs: 'owner',
          status: 'open',
          limit: HQ_JOURNAL_MAX_LIMIT
        })
        .filter((entry) => entry.kind === HQ_JOURNAL_KIND.chatReport && entry.dedupeKey)
      deps.pulse.record([
        ...asked.map((entry) => journalEntryAsInput(entry, { status: 'done' })),
        {
          workspace: from.workspace,
          placement: 'firm',
          kind: HQ_JOURNAL_KIND.sessionHandoff,
          at,
          project: from.project,
          address: from.address,
          sessionId: toSessionId,
          personId: null,
          title: `Handoff: a new chat continues ${from.address}`,
          needs: 'nobody',
          status: 'done',
          replyTo: null,
          refKind: 'session',
          refId: fromSessionId,
          source: 'handoff',
          dedupeKey: `session.handoff:${fromSessionId}:${toSessionId}`
        }
      ])
    }
  }
}

let provided: HqThreads | null = null

export function provideHqThreads(threads: HqThreads | null): void {
  provided = threads
}

export function getHqThreads(): HqThreads | null {
  return provided
}
