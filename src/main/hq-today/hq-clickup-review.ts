// Custom build (hq-clickup-review): «Разобрать» on a ClickUp change — Claude in the task's project looks
// into it and hands back a draft comment. A later change of the same task goes to that chat, and a
// project switched on for it starts the chat by itself, within the day's limit and the Claude limit.
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  HQ_CLICKUP_REVIEWS_FILE,
  hqClickUpAutostartAllowed,
  hqClickUpReviewFollowUp,
  hqClickUpReviewPrompt,
  parseHqClickUpReviewTuning,
  parseHqClickUpReviews,
  type HqClickUpReview,
  type HqClickUpReviews
} from '../../shared/hq-clickup-review'
import {
  HQ_SLACK_SCOUT_CONFIG_FILE,
  HQ_SLACK_SCOUT_DIR,
  type HqSlackScoutDraft
} from '../../shared/hq-slack-scout'
import { readHqSlackScout, writeRecordEntry } from './hq-slack-scout'

export type HqClickUpReviewDeps = {
  /** The project's workspace and shown name; null when no repo of it is open in Orca. */
  workspaceFor: (project: string) => Promise<{ worktreeId: string; name: string } | null>
  launch: (
    worktreeId: string,
    prompt: string
  ) => Promise<{ ok: true; sessionId: string; tabId?: string } | { ok: false; error: string }>
  /** False when the chat is closed and cannot take the message. */
  deliver: (sessionId: string, prompt: string) => Promise<boolean>
  /** Null when the active Claude account's usage is unread. */
  freePercent: () => number | null
  now: () => number
}

export type HqClickUpReviewStart =
  | { ok: true; worktreeId: string; tabId?: string }
  | { ok: false; error: string }

type Written = { ok: true } | { ok: false; error: string }

async function readText(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return null
  }
}

async function readReviews(hqPath: string): Promise<HqClickUpReviews> {
  return parseHqClickUpReviews(
    (await readText(join(hqPath, HQ_SLACK_SCOUT_DIR, HQ_CLICKUP_REVIEWS_FILE))) ?? '{}'
  )
}

function writeReview(
  hqPath: string,
  taskId: string,
  update: (current: HqClickUpReview | undefined) => HqClickUpReview | undefined
): Promise<void> {
  return writeRecordEntry(hqPath, HQ_CLICKUP_REVIEWS_FILE, parseHqClickUpReviews, taskId, update)
}

function opened(review: Pick<HqClickUpReview, 'worktreeId' | 'tabId'>): HqClickUpReviewStart {
  return {
    ok: true,
    worktreeId: review.worktreeId,
    ...(review.tabId ? { tabId: review.tabId } : {})
  }
}

/** The task's open chat takes the card; false when there is none or it is closed. */
async function continueReview(
  hqPath: string,
  card: HqSlackScoutDraft,
  taskId: string,
  review: HqClickUpReview | undefined,
  deps: HqClickUpReviewDeps
): Promise<boolean> {
  if (!review || !(await deps.deliver(review.sessionId, hqClickUpReviewFollowUp(card, taskId)))) {
    return false
  }
  await writeReview(hqPath, taskId, (current) => {
    if (!current) {
      return undefined
    }
    const { reply: _reply, summary: _summary, repliedAt: _at, ...rest } = current
    return { ...rest, cardId: card.id }
  })
  return true
}

// Why: a click and the autostart (or two clicks) must not start two chats on one task.
const starting = new Set<string>()

async function launchReview(
  hqPath: string,
  card: HqSlackScoutDraft,
  auto: boolean,
  deps: HqClickUpReviewDeps
): Promise<HqClickUpReviewStart> {
  const taskId = card.clickupTaskId
  if (!taskId || !card.project) {
    return { ok: false, error: 'This request names no ClickUp task or project.' }
  }
  if (starting.has(taskId)) {
    return { ok: false, error: 'Claude is already starting on this task.' }
  }
  starting.add(taskId)
  try {
    const workspace = await deps.workspaceFor(card.project)
    if (!workspace) {
      return { ok: false, error: `Project ${card.project} is not open in Orca.` }
    }
    const launched = await deps.launch(
      workspace.worktreeId,
      hqClickUpReviewPrompt(card, taskId, workspace.name)
    )
    if (!launched.ok) {
      return launched
    }
    const review: HqClickUpReview = {
      cardId: card.id,
      worktreeId: workspace.worktreeId,
      sessionId: launched.sessionId,
      ...(launched.tabId ? { tabId: launched.tabId } : {}),
      startedAt: new Date(deps.now()).toISOString(),
      ...(auto ? { auto: true } : {})
    }
    await writeReview(hqPath, taskId, () => review)
    return opened(review)
  } finally {
    starting.delete(taskId)
  }
}

/** «Разобрать»: the chat already on the card, the task's open chat, else a new one. */
export async function startHqClickUpReview(
  hqPath: string,
  draftId: string,
  deps: HqClickUpReviewDeps
): Promise<HqClickUpReviewStart> {
  const scout = await readHqSlackScout(hqPath, deps.now)
  const card = scout.ok ? scout.drafts.find((draft) => draft.id === draftId) : undefined
  if (!card?.clickupTaskId) {
    return { ok: false, error: 'This request is already decided.' }
  }
  if (card.review) {
    return opened(card.review)
  }
  const review = (await readReviews(hqPath))[card.clickupTaskId]
  if (review && (await continueReview(hqPath, card, card.clickupTaskId, review, deps))) {
    return opened(review)
  }
  return launchReview(hqPath, card, false, deps)
}

/** The chat's draft comment, from `orca pulse review reply`. */
export async function replyHqClickUpReview(
  hqPath: string,
  reply: { taskId: string; reply: string; summary?: string },
  now: () => number
): Promise<Written> {
  if (!(await readReviews(hqPath))[reply.taskId]) {
    return { ok: false, error: 'HQ has no review open for this ClickUp task.' }
  }
  await writeReview(hqPath, reply.taskId, (current) =>
    current
      ? {
          ...current,
          reply: reply.reply,
          ...(reply.summary ? { summary: reply.summary } : {}),
          repliedAt: new Date(now()).toISOString()
        }
      : undefined
  )
  return { ok: true }
}

/** After a triage pass: a task already looked into gets its new change in the same chat; a project
 *  switched on for it starts a chat by itself. */
export async function routeHqClickUpReviews(
  hqPath: string,
  cards: readonly HqSlackScoutDraft[],
  deps: HqClickUpReviewDeps
): Promise<void> {
  const fresh = cards.flatMap((card) =>
    card.needsReview && card.clickupTaskId ? [{ card, taskId: card.clickupTaskId }] : []
  )
  if (fresh.length === 0) {
    return
  }
  const tuning = parseHqClickUpReviewTuning(
    (await readText(join(hqPath, HQ_SLACK_SCOUT_DIR, HQ_SLACK_SCOUT_CONFIG_FILE))) ?? ''
  )
  for (const { card, taskId } of fresh) {
    const reviews = await readReviews(hqPath)
    if (await continueReview(hqPath, card, taskId, reviews[taskId], deps)) {
      continue
    }
    const allowed = hqClickUpAutostartAllowed({
      project: card.project,
      tuning,
      reviews,
      freePercent: deps.freePercent(),
      now: deps.now()
    })
    if (allowed) {
      const started = await launchReview(hqPath, card, true, deps)
      if (!started.ok) {
        console.warn('[hq-clickup-review] autostart failed:', started.error)
      }
    }
  }
}

export type HqClickUpReviewService = {
  start: (draftId: string) => Promise<HqClickUpReviewStart>
  reply: (reply: { taskId: string; reply: string; summary?: string }) => Promise<Written>
}

let provided: HqClickUpReviewService | null = null

export function provideHqClickUpReviewService(service: HqClickUpReviewService): void {
  provided = service
}

export function getHqClickUpReviewService(): HqClickUpReviewService | null {
  return provided
}
