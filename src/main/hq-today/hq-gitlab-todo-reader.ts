// Custom build (hq-ledger-sources): the owner's GitLab To-Do list, read through glab every two minutes
// and put into the request ledger — a review asked of him, an MR that cannot merge, a comment that
// turns to him. One MR is one conversation. A to-do he finished in GitLab (or that went with its MR)
// leaves his list, and its conversation stops showing; the next to-do on that MR opens it again.
import { hqPlaceKey, type HqLedgerResult, type HqLedgerSignal } from '../../shared/hq-ledger'
import { hqMrProjectOfRepo } from '../../shared/hq-mr-watch'
import type { HqLedgerGuess } from '../orca-plus/pulse/pulse-ledger'
import { createDebouncedSingleFlight } from '../orca-plus/debounced-single-flight'

/** The `reader` of the ledger messages this reader writes. */
export const HQ_GITLAB_TODO_READER = 'gitlab-todos'

const POLL_MS = 2 * 60_000
const FIRST_POLL_MS = 45_000
const PER_PAGE = 100
/** Why: a guard against a list that never ends, far above the owner's 27 to-dos (31.10). */
const MAX_PAGES = 5
/** Why: on start the asks of the last week and the mentions of the last day; older ones stay in GitLab. */
const FIRST_ASKS_MS = 7 * 24 * 60 * 60_000
const FIRST_MENTIONS_MS = 24 * 60 * 60_000
/** Why: a to-do can reach the list a little after its created_at; ingest is idempotent per to-do. */
const OVERLAP_MS = 10 * 60_000
/** Why: a burst of new MRs must not hold the pass on the model; the rest keep no project. */
const GUESSES_PER_PASS = 5
const TEXT_MAX = 2_000
const TITLE_MAX = 100

/** One pending to-do as GitLab lists it, read down to what the ledger needs. */
export type HqGitLabTodo = {
  id: string
  /** GitLab's `action_name`: `review_requested`, `mentioned`, `unmergeable`, … */
  action: string
  targetType: string
  targetUrl: string
  /** `opened`, `merged`, `closed`; null when GitLab did not say. */
  targetState: string | null
  targetTitle: string
  /** `group/repo`. */
  repo: string | null
  authorName: string | null
  authorUsername: string | null
  body: string
  createdAt: number
}

/** What each kind of to-do asks, as its card's title says it. */
const TODO_TITLE: Readonly<Record<string, string>> = {
  review_requested: 'Review requested',
  approval_required: 'Approval required',
  added_approver: 'Approval required',
  assigned: 'Assigned to you',
  build_failed: 'Build failed',
  unmergeable: 'Cannot merge',
  merge_train_removed: 'Removed from merge train',
  review_submitted: 'Review submitted',
  directly_addressed: 'Addressed to you',
  mentioned: 'Mentioned',
  marked: 'To-do'
}

/** Asks about the MR as it stands; once it merged or closed nothing is left to do. */
const WHILE_OPEN: ReadonlySet<string> = new Set([
  'review_requested',
  'approval_required',
  'added_approver',
  'assigned',
  'build_failed',
  'unmergeable',
  'merge_train_removed',
  'review_submitted'
])

/** GitLab's notices about the owner's own MR, and the to-do he added himself: their author may be him. */
const RAISED_FOR_OWNER: ReadonlySet<string> = new Set([
  'build_failed',
  'unmergeable',
  'merge_train_removed',
  'marked'
])

/** GitLab's bot users (`project_12_bot_…`, `group_3_bot_…`, `service_account_…`) and any name with
 *  `bot` as a part of it (`ci-bot`, `review_bot`). */
const BOT_NAME = /(?:^|[-_.])bot(?:[-_.\d]|$)|^service_account/i

function field(value: unknown, key: string): unknown {
  return value && typeof value === 'object' ? Reflect.get(value, key) : null
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null
}

export function parseHqGitLabTodos(rows: readonly unknown[]): HqGitLabTodo[] {
  return rows.flatMap((row) => {
    const id = field(row, 'id')
    const url = str(field(row, 'target_url'))
    const createdAt = Date.parse(str(field(row, 'created_at')) ?? '')
    if ((typeof id !== 'number' && typeof id !== 'string') || !url || !Number.isFinite(createdAt)) {
      return []
    }
    const target = field(row, 'target')
    const author = field(row, 'author')
    return [
      {
        id: String(id),
        action: str(field(row, 'action_name')) ?? '',
        targetType: str(field(row, 'target_type')) ?? '',
        targetUrl: url,
        targetState: str(field(target, 'state')),
        targetTitle: str(field(target, 'title')) ?? '',
        repo: str(field(field(row, 'project'), 'path_with_namespace')),
        authorName: str(field(author, 'name')),
        authorUsername: str(field(author, 'username')),
        body: str(field(row, 'body')) ?? '',
        createdAt
      }
    ]
  })
}

/** A bot or service account: by GitLab's naming of them, or named in HQ's config (`gitlab_bots`). */
export function hqGitLabIsBot(username: string | null, listed: ReadonlySet<string>): boolean {
  if (!username) {
    return true
  }
  return BOT_NAME.test(username) || listed.has(username.toLowerCase())
}

/** The conversation key of a to-do; null for anything but an MR's. */
export function hqGitLabTodoKey(todo: HqGitLabTodo): string | null {
  const key = todo.targetType === 'MergeRequest' ? hqPlaceKey(todo.targetUrl) : null
  return key?.startsWith('gitlab:') ? key : null
}

/** «Review requested: <MR title>». */
export function hqGitLabTodoTitle(todo: HqGitLabTodo): string {
  const kind =
    TODO_TITLE[todo.action] ??
    (todo.action ? todo.action.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()) : 'To-do')
  const line = `${kind}: ${todo.targetTitle || todo.targetUrl}`.replace(/\s+/g, ' ').trim()
  return line.length > TITLE_MAX ? `${line.slice(0, TITLE_MAX - 1)}…` : line
}

export type HqGitLabTodoContext = {
  /** The owner's GitLab username. */
  owner: string
  /** Lower-case usernames HQ's config names as bots. */
  bots: ReadonlySet<string>
  /** The HQ project the MR's repo is, by name; null leaves it to the owner's rule or the guess. */
  project: string | null
  /** The MR is a conversation already. */
  exists: boolean
  /** Another to-do on the MR still pending asks the owner; a bot's later mention must not hide it. */
  asked?: boolean
}

/** Whether a to-do asks the owner by its own kind (see hqLedgerSignalOfTodo). */
export function hqGitLabTodoAsks(
  todo: HqGitLabTodo,
  ctx: Pick<HqGitLabTodoContext, 'owner' | 'bots'>
): boolean {
  if (ownWords(todo, ctx.owner)) {
    return false
  }
  if (todo.action === 'mentioned') {
    return !hqGitLabIsBot(todo.authorUsername, ctx.bots)
  }
  const open = todo.targetState === null || todo.targetState === 'opened'
  return (
    todo.action === 'directly_addressed' ||
    todo.action === 'marked' ||
    (WHILE_OPEN.has(todo.action) && open)
  )
}

/** The owner's own words on the MR: his account wrote it, and it is no notice GitLab raised for him.
 *  Why: his agents comment under his account and name him (31.10: «Согласовано и влито … @owner»); that
 *  is his word on the MR, not a request. */
function ownWords(todo: HqGitLabTodo, owner: string): boolean {
  return (
    todo.authorUsername?.toLowerCase() === owner.toLowerCase() && !RAISED_FOR_OWNER.has(todo.action)
  )
}

/**
 * The ledger signal of one to-do; null for a to-do on anything but an MR, and for the owner's own
 * words on an MR that is no conversation yet. His move: a review, an approval, an assignment, a failed
 * pipeline or a conflict while the MR is open; a comment that turns to him; a mention by a person; a
 * to-do he added. A mention by a bot only tells.
 */
export function hqLedgerSignalOfTodo(
  todo: HqGitLabTodo,
  ctx: HqGitLabTodoContext
): HqLedgerSignal | null {
  const key = hqGitLabTodoKey(todo)
  if (!key) {
    return null
  }
  // Why: his own word only closes his move where one is open; it starts no conversation.
  const fromOwner = ownWords(todo, ctx.owner)
  if (fromOwner && !ctx.exists) {
    return null
  }
  const forOwner = !fromOwner && (hqGitLabTodoAsks(todo, ctx) || ctx.asked === true)
  const body = todo.body.trim()
  return {
    key,
    ts: `todo:${todo.id}`,
    at: todo.createdAt,
    author: todo.authorName ?? todo.authorUsername,
    authorId: todo.authorUsername,
    fromOwner,
    text: (body.length > TEXT_MAX ? `${body.slice(0, TEXT_MAX - 1)}…` : body) || todo.targetTitle,
    link: todo.targetUrl,
    reader: HQ_GITLAB_TODO_READER,
    forOwner,
    project: ctx.project,
    title: hqGitLabTodoTitle(todo)
  }
}

export type HqGitLabTodoDeps = {
  enabled: () => boolean
  /** One page of the owner's pending MR to-dos, as GitLab's JSON. */
  listPending: (page: number) => Promise<unknown>
  /** The owner's GitLab username. */
  owner: () => Promise<string>
  /** Usernames HQ's config names as bots (`gitlab_bots`). */
  bots: () => Promise<string[]>
  /** HQ's project slugs, to find an MR's project by its repo's name. */
  projects: () => Promise<string[]>
  ingest: (signal: HqLedgerSignal) => HqLedgerResult
  lastDirection: (key: string) => 'in' | 'out' | null
  /** The places of this reader's conversations that still show. */
  openKeys: () => string[]
  close: (key: string) => void
  /** The small model's project for a new MR no rule placed; null when it could not say. */
  guess: (todo: HqGitLabTodo) => Promise<HqLedgerGuess | null>
  setGuess: (conversationId: string, guess: HqLedgerGuess) => void
  now: () => number
}

export type HqGitLabTodoState = {
  /** When the last pass read the list; 0 before the first. */
  cursor: number
}

/** Every pending MR to-do; `complete` is false when the list ran past the page guard. */
async function listAll(
  deps: HqGitLabTodoDeps
): Promise<{ todos: HqGitLabTodo[]; complete: boolean }> {
  const todos: HqGitLabTodo[] = []
  for (let page = 1; page <= MAX_PAGES; page++) {
    const rows = await deps.listPending(page)
    // Why throw: an answer that is not a list must not read as «nothing pending» and close everything.
    if (!Array.isArray(rows)) {
      throw new Error('GitLab did not answer with a list of to-dos')
    }
    todos.push(...parseHqGitLabTodos(rows))
    if (rows.length < PER_PAGE) {
      return { todos, complete: true }
    }
  }
  return { todos, complete: false }
}

/** Whether a pass takes a to-do: after the last pass, or on the first one the week's asks and the
 *  day's mentions. */
function inWindow(todo: HqGitLabTodo, state: HqGitLabTodoState, now: number): boolean {
  if (state.cursor > 0) {
    return todo.createdAt >= state.cursor - OVERLAP_MS
  }
  const back = todo.action === 'mentioned' ? FIRST_MENTIONS_MS : FIRST_ASKS_MS
  return todo.createdAt >= now - back
}

/** One pass: new to-dos into the ledger, the finished ones' conversations closed. Returns the next state. */
export async function runHqGitLabTodoReader(
  deps: HqGitLabTodoDeps,
  state: HqGitLabTodoState
): Promise<HqGitLabTodoState> {
  const now = deps.now()
  const { todos, complete } = await listAll(deps)
  const [owner, bots, projects] = await Promise.all([
    deps.owner(),
    deps.bots(),
    deps.projects().catch(() => [])
  ])
  const botSet = new Set(bots.map((name) => name.toLowerCase()))
  const pending = new Set<string>()
  const asking = new Set<string>()
  for (const todo of todos) {
    const key = hqGitLabTodoKey(todo)
    if (key) {
      pending.add(key)
      if (hqGitLabTodoAsks(todo, { owner, bots: botSet })) {
        asking.add(key)
      }
    }
  }
  const fresh: { todo: HqGitLabTodo; result: HqLedgerResult }[] = []
  // Why oldest first: the ledger's state follows the newest message it was given.
  for (const todo of todos.toSorted((a, b) => a.createdAt - b.createdAt)) {
    const key = hqGitLabTodoKey(todo)
    if (!key || !inWindow(todo, state, now)) {
      continue
    }
    const project = todo.repo ? hqMrProjectOfRepo(todo.repo, projects) : null
    const signal = hqLedgerSignalOfTodo(todo, {
      owner,
      bots: botSet,
      project,
      exists: deps.lastDirection(key) !== null,
      asked: asking.has(key)
    })
    if (!signal) {
      continue
    }
    const result = deps.ingest(signal)
    if (result.added && !project && (result.step === 'new' || result.step === 'owner')) {
      fresh.push({ todo, result })
    }
  }
  // Why only on a whole list: a to-do past the page guard is not finished, only unread.
  if (complete) {
    for (const key of deps.openKeys()) {
      if (!pending.has(key)) {
        deps.close(key)
      }
    }
  }
  for (const { todo, result } of fresh.slice(0, GUESSES_PER_PASS)) {
    const guess = await deps.guess(todo).catch(() => null)
    // Why only the project: whose move it is and the title are GitLab's own word, not the model's.
    if (guess?.project) {
      deps.setGuess(result.conversationId, {
        project: guess.project,
        how: guess.how,
        state: 'fyi',
        gist: null
      })
    }
  }
  return { cursor: now }
}

export function startHqGitLabTodoReader(
  deps: HqGitLabTodoDeps,
  onError: (error: unknown) => void
): { stop: () => void } {
  let state: HqGitLabTodoState = { cursor: 0 }
  const flight = createDebouncedSingleFlight(
    async () => {
      if (deps.enabled()) {
        state = await runHqGitLabTodoReader(deps, state)
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
