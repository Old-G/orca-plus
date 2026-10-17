// Custom build (hq-clickup-requests): comments other people leave on the owner's ClickUp tasks become
// requests beside the Slack ones — read by Orca+ itself through the ClickUp API, no model involved.
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ClickUpComment, ClickUpTaskSummary } from '../../shared/clickup-types'
import {
  HQ_CLICKUP_OWN_FILE,
  HQ_CLICKUP_REQUESTS_FILE,
  HQ_SLACK_SCOUT_CONFIG_FILE,
  HQ_SLACK_SCOUT_DECISIONS_FILE,
  HQ_SLACK_SCOUT_DIR,
  parseHqSlackScoutDecisions,
  parseHqSlackScoutDrafts,
  parseHqSlackScoutTuning,
  type HqSlackScoutDraft
} from '../../shared/hq-slack-scout'

// Why: the first look goes back a day, like the Slack scout's first run.
const FIRST_LOOK_MS = 24 * 60 * 60_000
const ASK_MAX = 120
const QUOTE_MAX = 300
// Why: the scout looks for promises in the owner's last two days, as in Slack.
const OWN_KEEP_MS = 48 * 60 * 60_000
const OWN_TEXT_MAX = 1000

export type HqClickUpRequestsDeps = {
  /** The owner's open tasks, most recently updated first. */
  listMyTasks: () => Promise<ClickUpTaskSummary[]>
  listComments: (taskId: string) => Promise<ClickUpComment[]>
  /** The owner — the account ClickUp is connected with. */
  viewer: () => Promise<{ id: string; username: string }>
  /** HQ project slug of a ClickUp list, from HQ's list bindings. */
  projectForList: (listId: string | null) => string | null
  now: () => number
}

type RequestsFile = { lastCheckAt: number | null; drafts: HqSlackScoutDraft[] }

/** One of the owner's own comments: `to` is whom he answered, the last other author before it. */
type OwnComment = { link: string; task: string; to: string | null; text: string; at: number }

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

// Why: an agent's comment carries the footer Approve adds; it is the owner's own message.
const ORCA_FOOTER = /↳ [^\n]*\bref [0-9a-z]{6}(?![0-9a-z])/

function ownCommentsOn(
  task: ClickUpTaskSummary,
  ordered: readonly ClickUpComment[],
  ownerId: string,
  since: number
): OwnComment[] {
  return ordered.flatMap((comment, index): OwnComment[] => {
    const text = comment.body
      .split('\n')
      .filter((line) => !ORCA_FOOTER.test(line))
      .join('\n')
      .trim()
    if (comment.author?.id !== ownerId || (comment.createdAt ?? 0) <= since || !text) {
      return []
    }
    const answered = ordered
      .slice(0, index)
      .findLast((earlier) => earlier.author && earlier.author.id !== ownerId)
    return [
      {
        link: `${task.url}?comment=${encodeURIComponent(comment.id)}`,
        task: `${task.identifier} ${oneLine(task.title, 120)}`,
        to: answered?.author?.username ?? null,
        text: text.slice(0, OWN_TEXT_MAX),
        at: comment.createdAt ?? 0
      }
    ]
  })
}

/** Keeps the last two days of the owner's comments, the new ones merged in by link. */
async function writeOwnComments(dir: string, fresh: OwnComment[], now: number): Promise<void> {
  const path = join(dir, HQ_CLICKUP_OWN_FILE)
  let kept: OwnComment[] = []
  try {
    const raw: unknown = JSON.parse((await readOptional(path)) ?? '{}')
    const list = raw && typeof raw === 'object' ? Reflect.get(raw, 'comments') : null
    kept = (Array.isArray(list) ? list : []).flatMap((entry: unknown): OwnComment[] => {
      const field = (key: string): unknown =>
        entry && typeof entry === 'object' ? Reflect.get(entry, key) : undefined
      const [link, task, to, text, at] = ['link', 'task', 'to', 'text', 'at'].map(field)
      return typeof link === 'string' && typeof text === 'string' && typeof at === 'number'
        ? [
            {
              link,
              task: typeof task === 'string' ? task : '',
              to: typeof to === 'string' ? to : null,
              text,
              at
            }
          ]
        : []
    })
  } catch {
    kept = []
  }
  const byLink = new Map<string, OwnComment>()
  for (const entry of [...kept, ...fresh]) {
    if (entry.at > now - OWN_KEEP_MS) {
      byLink.set(entry.link, entry)
    }
  }
  const comments = [...byLink.values()].sort((a, b) => a.at - b.at)
  const temp = `${path}.${process.pid}.tmp`
  await writeFile(temp, `${JSON.stringify({ comments }, null, 2)}\n`)
  await rename(temp, path)
}

/** Custom build (hq-scout-quiet): a comment asks the owner when it @mentions him or asks a question;
 *  status notes and reports on his tasks are not requests. */
function asksTheOwner(comment: ClickUpComment, username: string): boolean {
  const body = comment.body
  return body.toLowerCase().includes(`@${username.toLowerCase()}`) || body.includes('?')
}

/** Adds a request per task whose newest comment since the owner last wrote there asks him something;
 *  the owner's own comment answers what was asked before it. The agents' account and comments with
 *  Orca+'s footer are not people. Returns how many were added. */
export async function collectHqClickUpRequests(
  hqPath: string,
  deps: HqClickUpRequestsDeps
): Promise<number> {
  const dir = join(hqPath, HQ_SLACK_SCOUT_DIR)
  const path = join(dir, HQ_CLICKUP_REQUESTS_FILE)
  const [current, decisionsText, configText] = await Promise.all([
    readOptional(path).then(readRequestsFile),
    readOptional(join(dir, HQ_SLACK_SCOUT_DECISIONS_FILE)),
    readOptional(join(dir, HQ_SLACK_SCOUT_CONFIG_FILE))
  ])
  const decisions = parseHqSlackScoutDecisions(decisionsText ?? '{}')
  const ignored = new Set(parseHqSlackScoutTuning(configText ?? '').clickUpIgnoreAuthors)
  const now = deps.now()
  const since = current.lastCheckAt ?? now - FIRST_LOOK_MS
  const [viewer, tasks] = await Promise.all([deps.viewer(), deps.listMyTasks()])
  const fresh: HqSlackScoutDraft[] = []
  const own: OwnComment[] = []
  const replaced = new Set<string>()
  for (const task of tasks) {
    if ((task.updatedAt ?? 0) <= since) {
      continue
    }
    const ordered = clickUpCommentsOldestFirst(await deps.listComments(task.id))
    own.push(...ownCommentsOn(task, ordered, viewer.id, now - OWN_KEEP_MS))
    const relevant = ordered.filter(
      (comment) =>
        (comment.createdAt ?? 0) > since &&
        comment.author &&
        !ignored.has(comment.author.id) &&
        !ORCA_FOOTER.test(comment.body)
    )
    const lastOwn = relevant.findLastIndex((comment) => comment.author?.id === viewer.id)
    // Why: the owner's own comment answers whatever was asked on the task before.
    if (lastOwn !== -1) {
      replaced.add(task.id)
    }
    const ask = relevant
      .slice(lastOwn + 1)
      .findLast((comment) => comment.body.trim() && asksTheOwner(comment, viewer.username))
    if (ask) {
      replaced.add(task.id)
      fresh.push(requestFrom(task, ask, deps.projectForList(task.listId), now))
    }
  }
  const kept = current.drafts.filter(
    (draft) =>
      !decisions[draft.id] &&
      !replaced.has(draft.clickupTaskId ?? '') &&
      // Why: a request kept from before an author was ignored goes with the next look.
      !ignored.has(draft.authorId ?? '')
  )
  await mkdir(dir, { recursive: true })
  const temp = `${path}.${process.pid}.tmp`
  const next: RequestsFile = { lastCheckAt: now, drafts: [...kept, ...fresh] }
  await writeFile(temp, `${JSON.stringify(next, null, 2)}\n`)
  await rename(temp, path)
  await writeOwnComments(dir, own, now)
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
