// Custom build (hq-clickup-requests): «Just reply» on a ClickUp comment — HQ drafts the owner's
// answer in his tone; Orca+ posts it only when he clicks Send, and keeps what he changed as a lesson.
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ClickUpComment, ClickUpMutationResult, ClickUpTask } from '../../shared/clickup-types'
import { HQ_TONE_GUIDE_PATH, hqClickUpReplyPrompt } from '../../shared/hq-slack-request-prompts'
import type { HqSlackScoutResult } from '../../shared/hq-slack-scout'
import { clickUpCommentsOldestFirst } from './hq-clickup-requests'
import { appendHqReplyCorrection, readHqReplyCorrections } from './hq-reply-corrections'

// Why: the last few comments carry the question's context; a long history only dilutes it.
const THREAD_COMMENTS = 8

export type HqClickUpReplyDeps = {
  readScout: (hqPath: string) => Promise<HqSlackScoutResult>
  getTask: (taskId: string) => Promise<ClickUpTask | null>
  listComments: (taskId: string) => Promise<ClickUpComment[]>
  addComment: (taskId: string, text: string) => Promise<ClickUpMutationResult>
  generate: (prompt: string) => Promise<{ ok: true; text: string } | { ok: false; error: string }>
  answered: (hqPath: string, id: string) => Promise<void>
  now: () => number
}

type Failure = { ok: false; error: string }

async function readText(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return null
  }
}

async function findTaskId(
  hqPath: string,
  id: string,
  deps: HqClickUpReplyDeps
): Promise<string | Failure> {
  const scout = await deps.readScout(hqPath)
  const request = scout.ok ? scout.drafts.find((draft) => draft.id === id) : null
  return request?.clickupTaskId ?? { ok: false, error: 'This ClickUp request is already decided.' }
}

export async function draftHqClickUpReply(
  hqPath: string,
  id: string,
  deps: HqClickUpReplyDeps
): Promise<{ ok: true; text: string } | Failure> {
  const taskId = await findTaskId(hqPath, id, deps)
  if (typeof taskId !== 'string') {
    return taskId
  }
  const [task, comments, tone, corrections] = await Promise.all([
    deps.getTask(taskId),
    deps.listComments(taskId),
    readText(join(hqPath, HQ_TONE_GUIDE_PATH)),
    readHqReplyCorrections(hqPath)
  ])
  if (!task) {
    return { ok: false, error: 'ClickUp did not return the task.' }
  }
  return deps.generate(
    hqClickUpReplyPrompt({
      task,
      comments: clickUpCommentsOldestFirst(comments)
        .slice(-THREAD_COMMENTS)
        .map((comment) => ({ author: comment.author?.username ?? '?', body: comment.body })),
      tone,
      corrections
    })
  )
}

/** Posts the owner's text as a comment, closes the request, and keeps a changed draft as a lesson. */
export async function sendHqClickUpReply(
  hqPath: string,
  reply: { id: string; text: string; draft?: string },
  deps: HqClickUpReplyDeps
): Promise<{ ok: true } | Failure> {
  const taskId = await findTaskId(hqPath, reply.id, deps)
  if (typeof taskId !== 'string') {
    return taskId
  }
  const posted = await deps.addComment(taskId, reply.text)
  if (!posted.ok) {
    return posted
  }
  await deps.answered(hqPath, reply.id)
  if (reply.draft) {
    await appendHqReplyCorrection(hqPath, {
      at: deps.now(),
      source: 'clickup',
      id: reply.id,
      draft: reply.draft,
      sent: reply.text
    })
  }
  return { ok: true }
}
