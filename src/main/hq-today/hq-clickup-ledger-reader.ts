// Custom build (hq-clickup-ledger, owner 03.11, plan stage 20.4): ClickUp comments straight into the
// request ledger, as Slack's are — every comment and thread reply on the owner's tasks and on the tasks
// ClickUp mails him about (he is tagged, watching or the author), both ways. Whose move: a tag is his
// move on any task; a question without a tag only on a task he is assigned to or wrote (С4), never on
// someone else's (С5). A comment linking a commit, MR or branch of one of his projects names that
// project (С6). It only proposes: cards and the owner's buttons stay as they are.
import type { ClickUpComment, ClickUpTask, ClickUpTaskSummary } from '../../shared/clickup-types'
import type { HqLedgerResult, HqLedgerSignal } from '../../shared/hq-ledger'
import { ORCA_FOOTER, clickUpCommentsOldestFirst } from './hq-clickup-requests'

/** The `reader` of the ledger messages this reader writes. */
export const HQ_CLICKUP_LEDGER_READER = 'clickup-api'

const TITLE_MAX = 100
const TEXT_MAX = 2_000
/** Why three days: the plan's live check reads that far back, and a slow thread is still one talk. */
const FIRST_LOOK_MS = 3 * 24 * 60 * 60_000
/** Why: ClickUp's `date_updated` and a comment's own time can trail a pass by a minute or two. */
const OVERLAP_MS = 10 * 60_000
/** Why: a long absence is read over several passes, not in one that holds the API for minutes. */
const TASKS_PER_PASS = 30
const WATCHED_KEEP_MS = 3 * 24 * 60 * 60_000

/** Tasks ClickUp mailed the owner about, by id or custom id, with when — the mail intake notes them. */
const watched = new Map<string, number>()

export function noteHqClickUpWatchedTask(ref: string, at: number): void {
  watched.set(ref, Math.max(at, watched.get(ref) ?? 0))
}

export function hqClickUpWatchedTasks(now: number): string[] {
  for (const [ref, at] of watched) {
    if (at < now - WATCHED_KEEP_MS) {
      watched.delete(ref)
    }
  }
  return [...watched.keys()]
}

export type HqClickUpLedgerDeps = {
  /** Tasks assigned to the owner, most recently updated first. */
  listMyTasks: () => Promise<ClickUpTaskSummary[]>
  /** Tasks known from ClickUp's mail: tagged, watching, his own. */
  watchedTasks: () => string[]
  getTask: (ref: string) => Promise<ClickUpTask | null>
  listComments: (taskId: string) => Promise<ClickUpComment[]>
  listReplies: (commentId: string) => Promise<ClickUpComment[]>
  viewer: () => Promise<{ id: string; username: string }>
  /** The HQ project of a ClickUp list, from the owner's mapping. */
  projectForList: (listId: string | null) => string | null
  /** ClickUp accounts that write for the owner — the agents' account (HQ config
   *  `clickup_ignore_authors`): their comments are his side, not people asking him. */
  ownAccounts: () => Promise<ReadonlySet<string>>
  /** The HQ project a link names (a repo path segment), for commits, MRs and branches. */
  projectOfLinks: (links: readonly string[]) => Promise<string | null>
  ingest: (signal: HqLedgerSignal) => HqLedgerResult
  now: () => number
}

export type HqClickUpLedgerState = { lastLookAt: number | null }

const URL = /https?:\/\/[^\s<>()"']+/g
/** A Slack thread mirrored into the task by a sync bot — the Slack reader has those lines already. */
const SLACK_MIRROR = /^\s*\[Slack Sync\]/

/** A link to code: a commit, an MR or PR, a branch or tree on GitLab or GitHub. */
const CODE_LINK = /\/(?:-\/)?(?:commit|merge_requests|pull|tree|compare)\//

function oneLine(text: string, max: number): string {
  const line = text.replace(/\s+/g, ' ').trim()
  return line.length > max ? `${line.slice(0, max - 1)}…` : line || '(no text)'
}

/** Whose move one comment is, by the plan's rules С4–С5. */
export function hqClickUpCommentForOwner(
  body: string,
  task: Pick<ClickUpTask, 'assignees' | 'creator'>,
  owner: { id: string; username: string }
): boolean {
  if (body.toLowerCase().includes(`@${owner.username.toLowerCase()}`)) {
    return true
  }
  const his = task.assignees.some((user) => user.id === owner.id) || task.creator?.id === owner.id
  return his && body.includes('?')
}

/** The links to code a comment carries: commits, MRs and PRs, branches. */
export function hqClickUpCodeLinks(body: string): string[] {
  return (body.match(URL) ?? [])
    .map((link) => link.replace(/[.,;:!?]+$/, ''))
    .filter((link) => CODE_LINK.test(link))
}

/** The ledger signal of one comment; null for Orca+'s own footer lines (the sent reader has them) and
 *  Slack mirrors. The agents' account writes for the owner, so its comments are his.
 *  `project`: the one its code links name, else its list's. */
export function hqLedgerSignalOfClickUp(
  task: ClickUpTask,
  comment: ClickUpComment,
  owner: { id: string; username: string },
  project: string | null,
  ownAccounts: ReadonlySet<string> = new Set()
): HqLedgerSignal | null {
  if (
    !comment.author ||
    !comment.body.trim() ||
    ORCA_FOOTER.test(comment.body) ||
    SLACK_MIRROR.test(comment.body)
  ) {
    return null
  }
  const fromOwner = comment.author.id === owner.id || ownAccounts.has(comment.author.id)
  const at = comment.createdAt ?? 0
  return {
    key: `clickup:${task.customId ?? task.id}`,
    ts: `comment:${comment.id}`,
    at,
    author: comment.author.username,
    authorId: comment.author.id,
    fromOwner,
    text: comment.body.slice(0, TEXT_MAX),
    link: `${task.url}?comment=${comment.id}`,
    reader: HQ_CLICKUP_LEDGER_READER,
    forOwner: !fromOwner && hqClickUpCommentForOwner(comment.body, task, owner),
    project,
    title: oneLine(`${task.customId ?? task.title}: ${task.title}`, TITLE_MAX)
  }
}

/** One pass: the tasks touched since the last one, their comments and replies since then, oldest
 *  first. Returns the next state and how many messages were new to the ledger. */
export async function runHqClickUpLedgerReader(
  deps: HqClickUpLedgerDeps,
  state: HqClickUpLedgerState
): Promise<{ state: HqClickUpLedgerState; added: number }> {
  const now = deps.now()
  const since = (state.lastLookAt ?? now - FIRST_LOOK_MS) - OVERLAP_MS
  const [owner, mine, ownAccounts] = await Promise.all([
    deps.viewer(),
    deps.listMyTasks(),
    deps.ownAccounts()
  ])
  const refs = new Set<string>([
    ...mine.filter((task) => (task.updatedAt ?? 0) >= since).map((task) => task.id),
    ...deps.watchedTasks()
  ])
  let added = 0
  for (const ref of [...refs].slice(0, TASKS_PER_PASS)) {
    const task = await deps.getTask(ref).catch(() => null)
    if (!task || (task.updatedAt ?? now) < since) {
      continue
    }
    const comments = clickUpCommentsOldestFirst(await deps.listComments(task.id))
    const all: ClickUpComment[] = []
    for (const comment of comments) {
      all.push(comment)
      if ((comment.replyCount ?? 0) > 0) {
        all.push(...(await deps.listReplies(comment.id).catch(() => [])))
      }
    }
    const fresh = clickUpCommentsOldestFirst(all).filter(
      (comment) => (comment.createdAt ?? 0) >= since
    )
    const forList = deps.projectForList(task.listId)
    for (const comment of fresh) {
      // Why С6 first: a commit or MR link says which repo the talk is about better than the list.
      const links = hqClickUpCodeLinks(comment.body)
      const project =
        (links.length > 0 ? await deps.projectOfLinks(links).catch(() => null) : null) ?? forList
      const signal = hqLedgerSignalOfClickUp(task, comment, owner, project, ownAccounts)
      if (signal && deps.ingest(signal).added) {
        added += 1
      }
    }
  }
  // Why: tasks left past the cap are read on the next pass from the same point.
  const done = refs.size <= TASKS_PER_PASS
  return { state: { lastLookAt: done ? now : (state.lastLookAt ?? now - FIRST_LOOK_MS) }, added }
}

const POLL_MS = 5 * 60_000
const FIRST_POLL_MS = 90_000

/** Reads every five minutes while the ledger is on; a missing ClickUp connection just skips. */
export function startHqClickUpLedgerReader(
  deps: HqClickUpLedgerDeps & { enabled: () => boolean },
  onError: (error: unknown) => void
): () => void {
  let state: HqClickUpLedgerState = { lastLookAt: null }
  let running = false
  const tick = (): void => {
    if (running || !deps.enabled()) {
      return
    }
    running = true
    void runHqClickUpLedgerReader(deps, state)
      .then((result) => {
        state = result.state
      })
      .catch(onError)
      .finally(() => {
        running = false
      })
  }
  const first = setTimeout(tick, FIRST_POLL_MS)
  const timer = setInterval(tick, POLL_MS)
  return () => {
    clearTimeout(first)
    clearInterval(timer)
  }
}
