// Custom build (hq-clickup-requests): comments other people leave on the owner's ClickUp tasks become
// requests beside the Slack ones — read by Orca+ itself through the ClickUp API, no model involved.
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ClickUpComment, ClickUpTaskSummary } from '../../shared/clickup-types'
import {
  HQ_CLICKUP_REQUESTS_FILE,
  HQ_SLACK_SCOUT_DECISIONS_FILE,
  HQ_SLACK_SCOUT_DIR,
  parseHqSlackScoutDecisions,
  parseHqSlackScoutDrafts,
  type HqSlackScoutDraft
} from '../../shared/hq-slack-scout'

// Why: the first look goes back a day, like the Slack scout's first run.
const FIRST_LOOK_MS = 24 * 60 * 60_000
const ASK_MAX = 120
const QUOTE_MAX = 300

export type HqClickUpRequestsDeps = {
  /** The owner's open tasks, most recently updated first. */
  listMyTasks: () => Promise<ClickUpTaskSummary[]>
  listComments: (taskId: string) => Promise<ClickUpComment[]>
  viewerId: () => Promise<string>
  /** HQ project slug of a ClickUp list, from HQ's list bindings. */
  projectForList: (listId: string | null) => string | null
  now: () => number
}

type RequestsFile = { lastCheckAt: number | null; drafts: HqSlackScoutDraft[] }

async function readOptional(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    if (error instanceof Error && Reflect.get(error, 'code') === 'ENOENT') {
      return null
    }
    throw error
  }
}

function readRequestsFile(text: string | null): RequestsFile {
  if (!text) {
    return { lastCheckAt: null, drafts: [] }
  }
  let lastCheckAt: unknown = null
  try {
    const raw: unknown = JSON.parse(text)
    lastCheckAt = raw && typeof raw === 'object' ? Reflect.get(raw, 'lastCheckAt') : null
  } catch {
    return { lastCheckAt: null, drafts: [] }
  }
  return {
    lastCheckAt: typeof lastCheckAt === 'number' ? lastCheckAt : null,
    drafts: parseHqSlackScoutDrafts(text).drafts
  }
}

/** Oldest first, whatever order ClickUp returned (its API lists the newest first). */
export function clickUpCommentsOldestFirst(comments: readonly ClickUpComment[]): ClickUpComment[] {
  return [...comments].sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0))
}

function oneLine(text: string, max: number): string {
  const line = text.replace(/\s+/g, ' ').trim()
  return line.length > max ? `${line.slice(0, max - 1)}…` : line
}

function requestFrom(
  task: ClickUpTaskSummary,
  comment: ClickUpComment,
  project: string | null,
  foundAt: number
): HqSlackScoutDraft {
  return {
    id: `clickup:${task.id}:${comment.id}`,
    source: 'clickup',
    clickupTaskId: task.id,
    kind: 'answer',
    channelName: `ClickUp · ${task.identifier}`,
    author: comment.author?.username ?? '',
    ...(comment.author ? { authorId: comment.author.id } : {}),
    permalink: task.url,
    quote: oneLine(comment.body, QUOTE_MAX),
    ask: oneLine(comment.body, ASK_MAX),
    title: oneLine(task.title, 300) || task.identifier,
    description: '',
    project,
    foundAt: new Date(foundAt).toISOString()
  }
}

/** Adds a request per task whose newest comment since the last look is someone else's; any newer
 *  comment on the task (the owner's answer too) replaces its undecided request. Returns how many
 *  were added. */
export async function collectHqClickUpRequests(
  hqPath: string,
  deps: HqClickUpRequestsDeps
): Promise<number> {
  const dir = join(hqPath, HQ_SLACK_SCOUT_DIR)
  const path = join(dir, HQ_CLICKUP_REQUESTS_FILE)
  const [current, decisionsText] = await Promise.all([
    readOptional(path).then(readRequestsFile),
    readOptional(join(dir, HQ_SLACK_SCOUT_DECISIONS_FILE))
  ])
  const decisions = parseHqSlackScoutDecisions(decisionsText ?? '{}')
  const now = deps.now()
  const since = current.lastCheckAt ?? now - FIRST_LOOK_MS
  const [viewer, tasks] = await Promise.all([deps.viewerId(), deps.listMyTasks()])
  const fresh: HqSlackScoutDraft[] = []
  const replaced = new Set<string>()
  for (const task of tasks) {
    if ((task.updatedAt ?? 0) <= since) {
      continue
    }
    const comments = await deps.listComments(task.id)
    const newest = clickUpCommentsOldestFirst(comments).findLast(
      (comment) => (comment.createdAt ?? 0) > since && comment.author
    )
    if (!newest) {
      continue
    }
    // Why: the owner's own newest comment answers whatever was asked on the task before.
    replaced.add(task.id)
    if (newest.author?.id !== viewer && newest.body.trim()) {
      fresh.push(requestFrom(task, newest, deps.projectForList(task.listId), now))
    }
  }
  const kept = current.drafts.filter(
    (draft) => !decisions[draft.id] && !replaced.has(draft.clickupTaskId ?? '')
  )
  await mkdir(dir, { recursive: true })
  const temp = `${path}.${process.pid}.tmp`
  const next: RequestsFile = { lastCheckAt: now, drafts: [...kept, ...fresh] }
  await writeFile(temp, `${JSON.stringify(next, null, 2)}\n`)
  await rename(temp, path)
  return fresh.length
}

// Why: the Slack scout's pace; ClickUp comments are rarely more urgent.
const LOOK_EVERY_MS = 10 * 60_000

/** Looks every ten minutes while HQ and «New view» are on; a missing ClickUp connection just skips. */
export function startHqClickUpRequests(deps: {
  hqPath: () => string | null
  enabled: () => boolean
  collect: (hqPath: string) => Promise<number>
  onAdded: () => void
}): () => void {
  let running = false
  const look = async (): Promise<void> => {
    const hq = deps.hqPath()
    if (running || !hq || !deps.enabled()) {
      return
    }
    running = true
    try {
      if ((await deps.collect(hq)) > 0) {
        deps.onAdded()
      }
    } catch (error) {
      console.warn(
        '[hq-clickup-requests] look failed:',
        error instanceof Error ? error.message : error
      )
    } finally {
      running = false
    }
  }
  void look()
  const timer = setInterval(() => void look(), LOOK_EVERY_MS)
  return () => clearInterval(timer)
}
