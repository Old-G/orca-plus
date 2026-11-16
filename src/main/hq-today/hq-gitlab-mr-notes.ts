// Custom build (hq-mr-comments, T14 of plan 2026-11-14): a person's plain comment on one of the owner's
// open MRs reaches the request ledger — GitLab puts it in his To-Do list only when it names him, so a
// reviewer's «move this to config» was seen nowhere. The MR's conversation goes with the chat working
// on its branch, and a ClickUp task named in the MR title (DEV-…) goes with that chat too when nobody
// holds it yet, so the card's «Send to chat» has its chat picked. Nothing reaches a chat by itself.
import type { HqMrChatDeps } from './hq-mr-chat'
import { hqPlaceKey, type HqLedgerResult, type HqLedgerSignal } from '../../shared/hq-ledger'
import { hqMrProjectOfRepo } from '../../shared/hq-mr-watch'
import { hqGitLabIsBot } from './hq-gitlab-todo-reader'
import { createDebouncedSingleFlight } from '../orca-plus/debounced-single-flight'
import { claudeBackgroundAllows } from '../claude-limit-guard/claude-background-gate'

/** The `reader` of the ledger messages this reader writes. */
export const HQ_GITLAB_MR_NOTES_READER = 'gitlab-mr-notes'

const POLL_MS = 2 * 60_000
const FIRST_POLL_MS = 75_000
/** Why a day: on start the comments of the last day; older ones were for a session that is gone. */
const FIRST_LOOK_MS = 24 * 60 * 60_000
/** Why: GitLab's `updated_at` and a note's own time can trail a pass by a minute or two. */
const OVERLAP_MS = 10 * 60_000
const TEXT_MAX = 2_000
const TITLE_MAX = 100
/** Why: the newest notes of one MR in one call; a review rarely leaves more between two passes. */
const NOTES_PER_MR = 50
const TASK_ID = /\b([A-Z][A-Z0-9]{1,9}-\d{2,})\b/g

/** One of the owner's open MRs, read down to what the reader needs. */
export type HqGitLabOpenMr = {
  projectId: number
  iid: number
  title: string
  url: string
  /** `group/repo`. */
  repo: string
  sourceBranch: string | null
  updatedAt: number
}

/** One comment on an MR, read down to what the ledger needs. */
export type HqGitLabMrNote = {
  id: string
  body: string
  /** GitLab's own lines («added 1 commit», «approved this merge request»). */
  system: boolean
  authorName: string | null
  authorUsername: string | null
  createdAt: number
  /** For a comment on a line of the diff: «src/a.ts:42». */
  place: string | null
}

function field(value: unknown, key: string): unknown {
  return value && typeof value === 'object' ? Reflect.get(value, key) : null
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null
}

function time(value: unknown): number {
  const at = typeof value === 'string' ? Date.parse(value) : Number.NaN
  return Number.isFinite(at) ? at : 0
}

/** GitLab's MR list as the reader's rows; anything that is not an MR is left out. */
export function parseHqGitLabOpenMrs(rows: unknown): HqGitLabOpenMr[] {
  if (!Array.isArray(rows)) {
    throw new Error('GitLab did not answer with a list of merge requests')
  }
  return rows.flatMap((row) => {
    const url = str(field(row, 'web_url'))
    const key = url ? hqPlaceKey(url) : null
    const projectId = Number(field(row, 'project_id'))
    const iid = Number(field(row, 'iid'))
    if (
      !url ||
      !key?.startsWith('gitlab:') ||
      !Number.isFinite(projectId) ||
      !Number.isFinite(iid)
    ) {
      return []
    }
    return [
      {
        projectId,
        iid,
        title: str(field(row, 'title')) ?? '',
        url,
        repo: key.slice('gitlab:'.length).replace(/![0-9]+$/, ''),
        sourceBranch: str(field(row, 'source_branch')),
        updatedAt: time(field(row, 'updated_at'))
      }
    ]
  })
}

/** GitLab's notes of one MR as the reader's rows. */
export function parseHqGitLabMrNotes(rows: unknown): HqGitLabMrNote[] {
  if (!Array.isArray(rows)) {
    throw new Error('GitLab did not answer with a list of comments')
  }
  return rows.flatMap((row) => {
    const id = field(row, 'id')
    if (typeof id !== 'number' && typeof id !== 'string') {
      return []
    }
    const author = field(row, 'author')
    const position = field(row, 'position')
    const path = str(field(position, 'new_path')) ?? str(field(position, 'old_path'))
    const line = field(position, 'new_line') ?? field(position, 'old_line')
    return [
      {
        id: String(id),
        body: str(field(row, 'body')) ?? '',
        system: field(row, 'system') === true,
        authorName: str(field(author, 'name')),
        authorUsername: str(field(author, 'username')),
        createdAt: time(field(row, 'created_at')),
        place: path ? (typeof line === 'number' ? `${path}:${String(line)}` : path) : null
      }
    ]
  })
}

/** The task ids an MR title names («DEV-18990: …»), as ClickUp's custom ids. */
export function hqMrTitleTasks(title: string): string[] {
  return [...new Set([...title.matchAll(TASK_ID)].map((match) => match[1]))]
}

export type HqGitLabMrNoteContext = {
  /** The owner's GitLab username — his agents write under it too. */
  owner: string
  /** Lower-case usernames HQ's config names as bots. */
  bots: ReadonlySet<string>
  project: string | null
}

/**
 * The ledger signal of one comment; null for GitLab's own lines, the owner's account (him or his
 * chats), bots, and a comment that names the owner — his To-Do list brings that one already.
 */
export function hqLedgerSignalOfMrNote(
  mr: HqGitLabOpenMr,
  note: HqGitLabMrNote,
  ctx: HqGitLabMrNoteContext
): HqLedgerSignal | null {
  const body = note.body.trim()
  const username = note.authorUsername?.toLowerCase() ?? null
  if (
    note.system ||
    !body ||
    username === ctx.owner.toLowerCase() ||
    hqGitLabIsBot(note.authorUsername, ctx.bots) ||
    new RegExp(`(^|[^\\w.-])@${escapeRegExp(ctx.owner)}(?![\\w-]|\\.\\w)`, 'i').test(body)
  ) {
    return null
  }
  const key = hqPlaceKey(mr.url)
  if (!key) {
    return null
  }
  const said = body.length > TEXT_MAX ? `${body.slice(0, TEXT_MAX - 1)}…` : body
  const title = `Comment: ${mr.title || mr.url}`.replace(/\s+/g, ' ').trim()
  return {
    key,
    ts: `note:${note.id}`,
    at: note.createdAt,
    author: note.authorName ?? note.authorUsername,
    authorId: note.authorUsername,
    fromOwner: false,
    text: note.place ? `${note.place}: ${said}` : said,
    link: `${mr.url}#note_${note.id}`,
    reader: HQ_GITLAB_MR_NOTES_READER,
    // Why his move: a person turning to his own open MR is his move, as a reviewer's to-do is (С7).
    forOwner: true,
    project: ctx.project,
    title: title.length > TITLE_MAX ? `${title.slice(0, TITLE_MAX - 1)}…` : title
  }
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export type HqGitLabMrNotesDeps = {
  enabled: () => boolean
  /** The owner's open MRs in the groups HQ follows, as GitLab's JSON. */
  listOpenMrs: (owner: string) => Promise<unknown>
  /** The newest comments of one MR, as GitLab's JSON. */
  listNotes: (projectId: number, iid: number, perPage: number) => Promise<unknown>
  owner: () => Promise<string>
  bots: () => Promise<string[]>
  projects: () => Promise<string[]>
  ingest: (signal: HqLedgerSignal) => HqLedgerResult
  chatOfBranch?: HqMrChatDeps['chatOfBranch']
  /** Gives a conversation its chat only when it has none: the MR's own, a ClickUp task its title names. */
  setChatIfNone?: (key: string, sessionId: string) => void
  /** The places of this reader's conversations that still show. */
  openKeys?: () => string[]
  /** Its MR is no longer open (merged or closed): the conversation is done. */
  close?: (key: string) => void
  /** One MR's comments could not be read; the others went on. */
  warn?: (message: string, detail: string) => void
  now: () => number
}

export type HqGitLabMrNotesState = {
  /** When the last pass began; 0 before the first. */
  cursor: number
  /** The chat of an MR's branch, with when it was looked up. */
  chats?: Map<string, { chat: string | null; at: number }>
  /** An MR whose comments could not be read, with the time its unread comments start from. */
  retry?: Map<string, number>
}

/** Why half an hour: finding a branch's chat lists every worktree; a chat rarely changes sooner. */
const CHAT_KEEP_MS = 30 * 60_000

/** One pass: the comments on the owner's MRs updated since the last pass into the ledger. */
export async function runHqGitLabMrNotes(
  deps: HqGitLabMrNotesDeps,
  state: HqGitLabMrNotesState
): Promise<HqGitLabMrNotesState> {
  const now = deps.now()
  const since = state.cursor > 0 ? state.cursor - OVERLAP_MS : now - FIRST_LOOK_MS
  const owner = await deps.owner()
  const [rows, bots, projects] = await Promise.all([
    deps.listOpenMrs(owner),
    deps.bots(),
    deps.projects().catch(() => [])
  ])
  const botSet = new Set(bots.map((name) => name.toLowerCase()))
  const chats = state.chats ?? new Map<string, { chat: string | null; at: number }>()
  const chatOf = async (project: string, branch: string): Promise<string | null> => {
    const cacheKey = `${project}\u0000${branch}`
    const known = chats.get(cacheKey)
    if (known && now - known.at < CHAT_KEEP_MS) {
      return known.chat
    }
    let failed = false
    const chat =
      (await deps.chatOfBranch?.(project, branch).catch(() => {
        failed = true
        return null
      })) ?? null
    // Why: a lookup that failed is asked again next pass, not taken as «no chat» for half an hour.
    if (!failed) {
      chats.set(cacheKey, { chat, at: now })
    }
    return chat
  }
  const failed: string[] = []
  const retry = new Map<string, number>()
  const open = new Set<string>()
  const mrs = parseHqGitLabOpenMrs(rows)
  for (const mr of mrs) {
    const project = hqMrProjectOfRepo(mr.repo, projects)
    const mrKey = hqPlaceKey(mr.url)
    if (mrKey) {
      open.add(mrKey)
    }
    // Why: an MR that failed keeps its own start, so the pass cursor moving on skips none of its comments.
    const owed = mrKey ? state.retry?.get(mrKey) : undefined
    const from = owed === undefined ? since : Math.min(owed, since)
    let notes: HqGitLabMrNote[] = []
    try {
      notes =
        owed !== undefined || mr.updatedAt >= from
          ? parseHqGitLabMrNotes(await deps.listNotes(mr.projectId, mr.iid, NOTES_PER_MR))
          : []
    } catch (error) {
      // Why: one MR GitLab will not show (moved, access lost) must not stop the others' comments.
      failed.push(
        `${mr.repo}!${String(mr.iid)}: ${error instanceof Error ? error.message : String(error)}`
      )
      if (mrKey) {
        retry.set(mrKey, from)
      }
    }
    // Why oldest first: the ledger's state follows the newest message it was given.
    for (const note of notes.toSorted((a, b) => a.createdAt - b.createdAt)) {
      if (note.createdAt < from) {
        continue
      }
      const signal = hqLedgerSignalOfMrNote(mr, note, { owner, bots: botSet, project })
      if (signal) {
        deps.ingest(signal)
      }
    }
    if (!project || !mr.sourceBranch) {
      continue
    }
    const chat = await chatOf(project, mr.sourceBranch)
    const key = hqPlaceKey(mr.url)
    if (!chat || !key) {
      continue
    }
    // Why only when none holds it: the chat the owner picked, or one that wrote there, stays; an MR
    // whose chat started after its comment still gets one on a later pass.
    deps.setChatIfNone?.(key, chat)
    for (const task of hqMrTitleTasks(mr.title)) {
      deps.setChatIfNone?.(`clickup:${task}`, chat)
    }
  }
  // Why: a merged or closed MR leaves the open list; its comment card has nothing left to act on.
  // The list is whole here — a failed read of it threw above.
  if (deps.close) {
    for (const key of deps.openKeys?.() ?? []) {
      if (!open.has(key)) {
        deps.close(key)
      }
    }
  }
  if (failed.length > 0) {
    deps.warn?.(`GitLab MR comments not read for ${String(failed.length)} MR(s)`, failed.join('\n'))
  }
  for (const [cacheKey, entry] of chats) {
    if (now - entry.at >= CHAT_KEEP_MS) {
      chats.delete(cacheKey)
    }
  }
  return { cursor: now, chats, retry }
}

export function startHqGitLabMrNotes(
  deps: HqGitLabMrNotesDeps,
  onError: (error: unknown) => void
): { stop: () => void } {
  let state: HqGitLabMrNotesState = { cursor: 0 }
  const flight = createDebouncedSingleFlight(
    async () => {
      if (deps.enabled() && claudeBackgroundAllows('GitLab MR notes')) {
        state = await runHqGitLabMrNotes(deps, state)
      }
    },
    onError,
    FIRST_POLL_MS
  )
  const timer = setInterval(() => void flight.runNow(), POLL_MS)
  timer.unref?.()
  flight.schedule()
  return {
    stop: () => {
      clearInterval(timer)
      flight.dispose()
    }
  }
}
