// Custom build (hq-clickup-waiting): a question asked in a ClickUp comment waits for its answer like a
// Slack one — Orca+ reads the replies under that comment (or beside it, when it was itself a reply in a
// thread) and the task's comments (no model), records the newest from someone else, and the
// waiting-reply relay hands it to the chat as quoted data.
import type { ClickUpComment } from '../../shared/clickup-types'
import {
  HQ_WAITING_REPLY_MAX,
  parseClickUpCommentRef,
  slackTsAt
} from '../../shared/hq-waiting-replies'
import type { PulseWaiting, PulseWaitingReply } from '../../shared/pulse-types'
import { clickUpCommentForOwner } from '../../shared/hq-reply-addressee'
import { createDebouncedSingleFlight } from '../orca-plus/debounced-single-flight'

// Why: ClickUp has no push for comments here; three minutes keeps two calls per question cheap.
const POLL_MS = 3 * 60_000
const FIRST_POLL_MS = 30_000

export type HqClickUpWaitingDeps = {
  listOpen: () => PulseWaiting[]
  /** The task's own id for a custom id such as DEV-123. */
  taskId: (taskRef: string) => Promise<string | null>
  listComments: (taskId: string) => Promise<ClickUpComment[]>
  listReplies: (commentId: string) => Promise<ClickUpComment[]>
  /** The owner — the account ClickUp is connected with. */
  viewer: () => Promise<{ id: string; username: string }>
  /** The ClickUp user id of the person a waiting is on, when known. */
  clickUpUserId: (personId: string) => string | null
  recordReply: (id: string, reply: PulseWaitingReply) => PulseWaiting | null
}

function newestAnswer(
  comments: readonly ClickUpComment[],
  after: number,
  viewer: { id: string; username: string },
  askedIn: string | null
): ClickUpComment | null {
  let newest: ClickUpComment | null = null
  for (const comment of comments) {
    const at = comment.createdAt ?? 0
    // Why: the owner's own comments and the question itself are not answers.
    if (at <= after || comment.id === askedIn || comment.author?.id === viewer.id) {
      continue
    }
    // Custom build (hq-reply-addressee): a comment to someone else is their conversation.
    if (!clickUpCommentForOwner(comment.body, viewer.username)) {
      continue
    }
    if (!newest || at > (newest.createdAt ?? 0)) {
      newest = comment
    }
  }
  return newest
}

/** Why: on a busy task only what is addressed to the owner answers him — anyone's text reaches the chat. */
function addressedTo(comment: ClickUpComment, username: string): boolean {
  return comment.body.toLowerCase().includes(`@${username.toLowerCase()}`)
}

/** The thread a question sits in when it was itself a reply; ClickUp threads are one level deep, so
 *  its answers land beside it. Null for a top-level question or one not found among recent threads. */
async function threadOf(
  deps: HqClickUpWaitingDeps,
  comments: readonly ClickUpComment[],
  questionId: string,
  parents: Map<string, string | null>
): Promise<string | null> {
  if (comments.some((comment) => comment.id === questionId)) {
    return null
  }
  const known = parents.get(questionId)
  if (known !== undefined) {
    return known
  }
  let parent: string | null = null
  for (const comment of comments.toReversed()) {
    if (comment.replyCount === 0) {
      continue
    }
    const replies = await deps.listReplies(comment.id)
    if (replies.some((reply) => reply.id === questionId)) {
      parent = comment.id
      break
    }
  }
  // Why: a thread never moves, and the search costs a call per thread.
  parents.set(questionId, parent)
  return parent
}

/** Records each open ClickUp waiting's newest answer; returns how many were new. */
export async function pollHqClickUpWaitingReplies(
  deps: HqClickUpWaitingDeps,
  parents = new Map<string, string | null>()
): Promise<number> {
  const watched = deps.listOpen().flatMap((waiting) => {
    const ref = waiting.direction === 'on-them' ? parseClickUpCommentRef(waiting.sourceRef) : null
    return ref && waiting.status === 'open' ? [{ waiting, ref }] : []
  })
  if (watched.length === 0) {
    return 0
  }
  const viewer = await deps.viewer()
  let recorded = 0
  for (const { waiting, ref } of watched) {
    try {
      const taskId = await deps.taskId(ref.taskRef)
      if (!taskId) {
        continue
      }
      const comments = await deps.listComments(taskId)
      const thread = ref.commentId ? await threadOf(deps, comments, ref.commentId, parents) : null
      const replies = ref.commentId ? await deps.listReplies(thread ?? ref.commentId) : []
      const since = Math.max(waiting.createdAt, Math.round(Number(waiting.replyTs ?? 0) * 1000))
      const awaited = waiting.personId ? deps.clickUpUserId(waiting.personId) : null
      const counts = (comment: ClickUpComment): boolean =>
        (awaited !== null && comment.author?.id === awaited) ||
        addressedTo(comment, viewer.username)
      // Anyone's reply under the asking comment; beside it in a thread and on the task, only the
      // person it waits on or a comment that @mentions the owner.
      const candidates = thread
        ? [...replies, ...comments].filter(counts)
        : [...replies, ...comments.filter(counts)]
      const answer = newestAnswer(candidates, since, viewer, ref.commentId)
      if (answer?.body.trim()) {
        deps.recordReply(waiting.id, {
          text: answer.body.trim().slice(0, HQ_WAITING_REPLY_MAX),
          author: answer.author?.username ?? null,
          ts: slackTsAt(answer.createdAt ?? Date.now()),
          link: `https://app.clickup.com/t/${taskId}?comment=${answer.id}`
        })
        recorded += 1
      }
    } catch (error) {
      console.warn(`[hq-clickup-waiting] reading ${waiting.id} failed:`, error)
    }
  }
  return recorded
}

// Why: not on every pulse change — those are frequent, and each pass costs ClickUp calls.
export function startHqClickUpWaitingReplies(deps: HqClickUpWaitingDeps): () => void {
  const parents = new Map<string, string | null>()
  const flight = createDebouncedSingleFlight(
    async () => {
      await pollHqClickUpWaitingReplies(deps, parents)
    },
    (error) => console.warn('[hq-clickup-waiting] poll failed:', error),
    FIRST_POLL_MS
  )
  const timer = setInterval(() => void flight.runNow(), POLL_MS)
  timer.unref?.()
  flight.schedule()
  return () => {
    clearInterval(timer)
    flight.dispose()
  }
}
