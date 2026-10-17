// Custom build (hq-clickup-waiting): a question asked in a ClickUp comment waits for its answer like a
// Slack one — Orca+ reads the replies under that comment and the task's comments that @mention the
// owner itself (no model), records the newest from someone else, and the waiting-reply relay hands it
// to the chat as quoted data.
import type { ClickUpComment } from '../../shared/clickup-types'
import {
  HQ_WAITING_REPLY_MAX,
  parseClickUpCommentRef,
  slackTsAt
} from '../../shared/hq-waiting-replies'
import type { PulseWaiting, PulseWaitingReply } from '../../shared/pulse-types'
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
  recordReply: (id: string, reply: PulseWaitingReply) => PulseWaiting | null
}

function newestAnswer(
  comments: readonly ClickUpComment[],
  after: number,
  viewerId: string,
  askedIn: string | null
): ClickUpComment | null {
  let newest: ClickUpComment | null = null
  for (const comment of comments) {
    const at = comment.createdAt ?? 0
    // Why: the owner's own comments and the question itself are not answers.
    if (at <= after || comment.id === askedIn || comment.author?.id === viewerId) {
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

/** Records each open ClickUp waiting's newest answer; returns how many were new. */
export async function pollHqClickUpWaitingReplies(deps: HqClickUpWaitingDeps): Promise<number> {
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
      const [comments, replies] = await Promise.all([
        deps.listComments(taskId),
        ref.commentId ? deps.listReplies(ref.commentId) : Promise.resolve([])
      ])
      const since = Math.max(waiting.createdAt, Math.round(Number(waiting.replyTs ?? 0) * 1000))
      // A reply under the asking comment, or a task comment that @mentions the owner.
      const candidates = [
        ...replies,
        ...comments.filter((comment) => addressedTo(comment, viewer.username))
      ]
      const answer = newestAnswer(candidates, since, viewer.id, ref.commentId)
      if (answer?.body.trim()) {
        deps.recordReply(waiting.id, {
          text: answer.body.trim().slice(0, HQ_WAITING_REPLY_MAX),
          author: answer.author?.username ?? null,
          ts: slackTsAt(answer.createdAt ?? Date.now())
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
  const flight = createDebouncedSingleFlight(
    async () => {
      await pollHqClickUpWaitingReplies(deps)
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
