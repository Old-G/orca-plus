// Custom build (hq-plus-journal): plain-text views for `orca hq`, short enough for a model's context.
import type {
  HqEventsResult,
  HqThreadResult,
  HqJournalEntry,
  HqJournalHeader,
  HqWhoami
} from '../shared/hq-journal'
import type { HqRouteActionKind, HqRouteResult } from '../shared/hq-routing'
import type { HqWhereResult } from '../shared/hq-context'
import type {
  HqDispatchDecision,
  HqDispatchResult,
  HqSessionsResult,
  HqSweepAction
} from '../shared/hq-sessions'

const BODY_PREVIEW = 160

function stamp(at: number): string {
  const date = new Date(at)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function line(entry: HqJournalHeader, withRoom: boolean): string {
  return [
    stamp(entry.at),
    withRoom ? `[${entry.workspace}]` : null,
    entry.kind,
    entry.status === 'open' ? entry.needs : `${entry.needs} (${entry.status})`,
    entry.project ? `· ${entry.project}` : null,
    `— ${entry.title}`,
    ` ${entry.id}`
  ]
    .filter((part): part is string => part !== null)
    .join(' ')
}

function preview(entry: HqJournalEntry, full: boolean): string | null {
  const body = entry.body?.replace(/\s+/g, ' ').trim()
  // Why: a title cut at 140 characters still hides the rest, which a full read must show.
  if (!body || (entry.title.includes(body.slice(0, 40)) && (!full || body.length <= 140))) {
    return null
  }
  return `    ${!full && body.length > BODY_PREVIEW ? `${body.slice(0, BODY_PREVIEW - 1)}…` : body}`
}

// Custom build (hq-plus-ask): a short answer shows each row's whole text, so it needs no second read.
const FULL_TEXT_UP_TO = 10

// Custom build (hq-plus-ask): an answer cites the row's own sources.
function sources(entry: HqJournalEntry): string | null {
  const refs = entry.links.map((link) => link.url ?? `${link.kind}:${link.id ?? ''}`)
  return refs.length > 0 ? `    ↳ ${refs.join(' · ')}` : null
}

export function formatHqEvents(result: HqEventsResult): string {
  if (result.scope === 'overview') {
    const head = `HQ+ overview — headings of every room (${result.headers.length}). Full entries: --room <slug>.`
    return result.headers.length === 0
      ? `${head}\nNo events.`
      : [head, ...result.headers.map((entry) => line(entry, true))].join('\n')
  }
  const name = result.roomName ? ` (${result.roomName})` : ''
  const full = result.entries.length <= FULL_TEXT_UP_TO
  const head = `Room ${result.room}${name} — ${result.entries.length} event(s)${full ? '' : '; text shortened, narrow with --query or --limit 10 for the whole text'}.`
  if (result.entries.length === 0) {
    return `${head}\nNo events.`
  }
  return [
    head,
    ...result.entries.flatMap((entry) =>
      [line(entry, false), preview(entry, full), sources(entry)].filter(
        (part): part is string => part !== null
      )
    )
  ].join('\n')
}

export function formatHqWhoami(whoami: HqWhoami): string {
  const room = whoami.overview
    ? 'HQ+ overview — every room, headings only'
    : `${whoami.room ?? 'none'}${whoami.roomName ? ` (${whoami.roomName})` : ''}`
  return [
    `Session: ${whoami.sessionId ?? 'none (not an Orca chat)'}`,
    `Room: ${room}`,
    `Project: ${whoami.project ?? 'none'}`,
    `Address: ${whoami.address ?? 'none yet'}`,
    `Task: ${whoami.task ?? 'none'}`
  ].join('\n')
}

/** Custom build (hq-plus-reports): a thread as one conversation, answers quoting what they answer. */
export function formatHqThread(thread: HqThreadResult): string {
  const byId = new Map(thread.entries.map((entry) => [entry.id, entry]))
  const chats = thread.sessions.map((session) => `${session.sessionId} (${session.state})`)
  return [
    `Thread ${thread.address} — ${thread.entries.length} entr${thread.entries.length === 1 ? 'y' : 'ies'}; chats: ${chats.join(', ') || 'none'}.`,
    ...thread.entries.flatMap((entry) => {
      const quoted = entry.replyTo ? byId.get(entry.replyTo) : undefined
      return [
        line(entry, false),
        ...(quoted ? [`    ↳ in reply to: ${quoted.title}`] : []),
        ...(entry.body ? entry.body.split('\n').map((text) => `    ${text}`) : [])
      ]
    })
  ].join('\n')
}

// Custom build (hq-plus-routing)
const ROUTE_VERB: Readonly<Record<HqRouteActionKind, string>> = {
  open: 'open a fixing chat',
  continue: "hand to today's chat",
  suggest: 'ask the owner (autonomy 0)',
  wait: 'wait'
}

export function formatHqRoute(result: HqRouteResult): string {
  const lines = result.actions.map((action) => {
    const verb = result.dryRun ? `would ${ROUTE_VERB[action.kind]}` : ROUTE_VERB[action.kind]
    const where = action.address ? ` → ${action.address}` : ''
    const note = action.note ? ` (${action.note})` : ''
    return `${action.project} [${action.workspace}] · ${action.findings.length} finding(s), level ${action.level ?? '?'}: ${verb}${where}${note}`
  })
  return [
    ...(lines.length > 0 ? lines : ['Nothing to route now.']),
    ...result.problems.map((problem) => `routing.yaml: ${problem}`)
  ].join('\n')
}

/** Custom build (hq-plus-context): the knowledge map's best rows for a question. */
export function formatHqWhere(result: HqWhereResult): string {
  if (result.answers.length === 0) {
    return `Nothing in ${result.file} matches; read it whole or ask the owner where this lives.`
  }
  return result.answers.map((answer) => `${answer.question}\n  → ${answer.where}`).join('\n')
}

// Custom build (hq-plus-sessions)
function decisionLine(decision: HqDispatchDecision, would: boolean): string {
  const verb =
    decision.kind === 'continue'
      ? `continue it in ${decision.sessionId}`
      : decision.kind === 'new'
        ? `open a new chat${decision.seedFrom ? ` seeded from ${decision.seedFrom}` : ''}`
        : 'queue the work'
  return `${decision.address}: ${would ? 'would ' : ''}${verb} — ${decision.why}`
}

export function formatHqDispatch(result: HqDispatchResult): string {
  return [
    decisionLine(result.decision, !result.acted),
    result.acted && result.sessionId ? `chat ${result.sessionId}` : null,
    result.entryId ? `journal ${result.entryId}` : null,
    result.note
  ]
    .filter((part): part is string => part !== null)
    .join('\n')
}

function sweepLine(action: HqSweepAction, would: boolean): string {
  const verb = would ? 'would ' : ''
  switch (action.kind) {
    case 'successor':
      return `handoff of ${action.address ?? action.sessionId}: ${verb}start the next chat — ${action.why}`
    case 'drain':
      return `queued ${action.entryId}: ${decisionLine(action.decision, would)}`
    case 'lost':
      return `lost: ${action.why} (${action.entryIds.join(', ')})`
  }
}

const SESSIONS_SHOWN = 25
const DAY_MS = 86_400_000

export function formatHqSessions(result: HqSessionsResult): string {
  const now = Date.now()
  const recent = result.sessions.filter(
    (session) => session.midTurn || now - session.lastActivityAt < DAY_MS
  )
  const rows = recent
    .slice(0, SESSIONS_SHOWN)
    .map((session) =>
      [
        session.state.padEnd(7),
        session.address ?? '—',
        session.name ? `«${session.name}»` : null,
        session.project ? `· ${session.project}` : null,
        session.contextPct !== null ? `ctx ${session.contextPct}%` : null,
        `active ${Math.round((now - session.lastActivityAt) / 60_000)} min ago`,
        session.ownerAt !== null && now - session.ownerAt < 30 * 60_000 ? 'owner in it' : null,
        session.tabOpen ? null : '(in History)',
        session.sessionId
      ]
        .filter((part): part is string => part !== null)
        .join('  ')
    )
  const older = result.sessions.length - Math.min(recent.length, SESSIONS_SHOWN)
  const would = result.dryRun || result.mode !== 'on'
  return [
    `Dispatcher: ${result.mode}. Queued: ${result.queued}. Questions to the owner: ${result.unreviewed}.`,
    ...(rows.length > 0 ? rows : ['No chat active in the last day.']),
    ...(older > 0 ? [`… and ${older} older or quieter chats (--json lists all).`] : []),
    '',
    ...(result.actions.length > 0
      ? result.actions.map((action) => sweepLine(action, would))
      : ['Nothing for the dispatcher to do now.'])
  ].join('\n')
}
