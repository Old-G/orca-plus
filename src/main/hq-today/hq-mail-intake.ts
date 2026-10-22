// Custom build (hq-mail-intake): GitLab and ClickUp notification emails, read by Orca+ itself through
// the Gmail API. An email only names what happened; GitLab and ClickUp are asked whether it is so —
// a merged MR closes the waiting that holds its link, a ClickUp mention or a shared task becomes a
// request card exactly like the ones the ClickUp API finds.
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ClickUpComment, ClickUpTask } from '../../shared/clickup-types'
import {
  HQ_MAIL_SENDERS,
  hqMailEvent,
  hqMergeRequestKey,
  type HqMail,
  type HqMailEvent
} from '../../shared/hq-mail-events'
import {
  HQ_CLICKUP_REQUESTS_FILE,
  HQ_MAIL_REQUESTS_FILE,
  HQ_MAIL_STATE_FILE,
  HQ_SLACK_SCOUT_CONFIG_FILE,
  HQ_SLACK_SCOUT_DECISIONS_FILE,
  HQ_SLACK_SCOUT_DIR,
  parseHqSlackScoutDecisions,
  parseHqSlackScoutDrafts,
  parseHqSlackScoutTuning,
  type HqSlackScoutDraft
} from '../../shared/hq-slack-scout'
import { HQ_CLICKUP_TRIAGE_FILE } from '../../shared/hq-clickup-triage'
import type { PulseWaiting } from '../../shared/pulse-types'
import {
  asksTheOwner,
  clickUpCommentsOldestFirst,
  hqClickUpRequestFrom,
  ORCA_FOOTER
} from './hq-clickup-requests'

// Why: the first look goes back a day, like the ClickUp and Slack collectors.
const FIRST_LOOK_MS = 24 * 60 * 60_000
// Why: Gmail's internalDate can trail the last look by a few minutes; seen ids stop repeats.
const OVERLAP_MS = 30 * 60_000
const SEEN_MAX = 1000
// Why: every email since the last look is read before it moves; this only bounds a very long absence.
const PER_LOOK_MAX = SEEN_MAX
const QUOTE_MAX = 300

/** Notification emails from `since` (ms) on; Gmail's `after:` takes seconds. */
export function hqMailQuery(since: number): string {
  return `after:${Math.floor(since / 1000)} {${HQ_MAIL_SENDERS.map((sender) => `from:${sender}`).join(' ')}}`
}

export type HqMailIntakeDeps = {
  listMailIds: (query: string, max: number) => Promise<string[]>
  getMail: (id: string) => Promise<HqMail | null>
  getTask: (ref: string) => Promise<HqMailTask | null>
  listComments: (taskId: string) => Promise<ClickUpComment[]>
  viewer: () => Promise<{ id: string; username: string }>
  projectForList: (listId: string | null) => string | null
  listOpenWaitings: () => readonly Pick<PulseWaiting, 'id' | 'title' | 'sourceRef'>[]
  /** Who merged the MR when GitLab says it is merged, `null` when it does not say who; false if not merged. */
  mergedBy: (event: Extract<HqMailEvent, { kind: 'mr-merged' }>) => Promise<string | null | false>
  closeWaiting: (id: string, resolution: string) => void
  notify: (title: string, body: string) => void
  now: () => number
}

/** What the intake reads of a ClickUp task. */
export type HqMailTask = Pick<
  ClickUpTask,
  'id' | 'identifier' | 'title' | 'url' | 'description' | 'listId'
>

type MailState = { lastCheckAt: number | null; seen: string[] }

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

function readState(text: string | null): MailState {
  try {
    const raw: unknown = text ? JSON.parse(text) : null
    const lastCheckAt: unknown =
      raw && typeof raw === 'object' ? Reflect.get(raw, 'lastCheckAt') : null
    const seen: unknown = raw && typeof raw === 'object' ? Reflect.get(raw, 'seen') : null
    return {
      lastCheckAt: typeof lastCheckAt === 'number' ? lastCheckAt : null,
      seen: Array.isArray(seen) ? seen.filter((id): id is string => typeof id === 'string') : []
    }
  } catch {
    return { lastCheckAt: null, seen: [] }
  }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  const temp = `${path}.${process.pid}.tmp`
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`)
  await rename(temp, path)
}

function oneLine(text: string, max: number): string {
  const line = text.replace(/\s+/g, ' ').trim()
  return line.length > max ? `${line.slice(0, max - 1)}…` : line
}

/** A task shared with or assigned to the owner, as a request to take. */
function taskRequest(
  task: HqMailTask,
  event: Extract<HqMailEvent, { kind: 'clickup-task' }>,
  project: string | null,
  foundAt: number
): HqSlackScoutDraft {
  return {
    id: `clickup-task:${task.id}`,
    source: 'clickup',
    clickupTaskId: task.id,
    kind: 'do',
    channelName: `ClickUp · ${task.identifier}`,
    author: '',
    permalink: task.url,
    quote: oneLine(task.description, QUOTE_MAX),
    ask: event.action === 'shared' ? 'Shared with you in ClickUp' : 'Assigned to you in ClickUp',
    title: oneLine(task.title, 300) || task.identifier,
    description: '',
    project,
    foundAt: new Date(foundAt).toISOString()
  }
}

/** The owner wrote on the task after the comment: the request is answered. */
function answeredAfter(
  ordered: readonly ClickUpComment[],
  commentId: string,
  ownerId: string
): boolean {
  const index = ordered.findIndex((comment) => comment.id === commentId)
  return index !== -1 && ordered.slice(index + 1).some((comment) => comment.author?.id === ownerId)
}

/** Reads the emails that came since the last look and acts on each one once. Returns how many
 *  request cards were added. */
export async function collectHqMailIntake(hqPath: string, deps: HqMailIntakeDeps): Promise<number> {
  const dir = join(hqPath, HQ_SLACK_SCOUT_DIR)
  const [stateText, cardsText, decisionsText, configText, clickupText, triageText] =
    await Promise.all(
      [
        HQ_MAIL_STATE_FILE,
        HQ_MAIL_REQUESTS_FILE,
        HQ_SLACK_SCOUT_DECISIONS_FILE,
        HQ_SLACK_SCOUT_CONFIG_FILE,
        HQ_CLICKUP_REQUESTS_FILE,
        HQ_CLICKUP_TRIAGE_FILE
      ].map((file) => readOptional(join(dir, file)))
    )
  const state = readState(stateText)
  const decisions = parseHqSlackScoutDecisions(decisionsText ?? '{}')
  const ignored = new Set(parseHqSlackScoutTuning(configText ?? '').clickUpIgnoreAuthors)
  const now = deps.now()
  const since = state.lastCheckAt === null ? now - FIRST_LOOK_MS : state.lastCheckAt - OVERLAP_MS
  const seen = new Set(state.seen)
  // Why: a request the ClickUp collector or the triage already shows is not raised twice.
  const others = [clickupText, triageText].flatMap(
    (text) => parseHqSlackScoutDrafts(text ?? '{}').drafts
  )
  const shownIds = new Set(others.map((draft) => draft.id))
  const shownTasks = new Set(
    others.flatMap((draft) => (draft.clickupTaskId ? [draft.clickupTaskId] : []))
  )
  let kept = parseHqSlackScoutDrafts(cardsText ?? '{}').drafts.filter(
    (draft) => !decisions[draft.id]
  )
  const fresh: HqSlackScoutDraft[] = []
  let viewer: { id: string; username: string } | null = null
  const owner = async (): Promise<{ id: string; username: string }> =>
    (viewer ??= await deps.viewer())

  const listed = await deps.listMailIds(hqMailQuery(since), PER_LOOK_MAX)
  if (listed.length >= PER_LOOK_MAX) {
    console.warn(`[hq-mail-intake] ${PER_LOOK_MAX}+ emails since the last look; older ones skipped`)
  }
  const ids = listed.filter((id) => !seen.has(id))
  for (const id of ids.toReversed()) {
    const mail = await deps.getMail(id)
    seen.add(id)
    const event = mail && mail.receivedAt >= since ? hqMailEvent(mail) : null
    if (!event) {
      continue
    }
    if (event.kind === 'mr-merged') {
      const key = hqMergeRequestKey(event.mrUrl)
      const waiting = deps
        .listOpenWaitings()
        .filter((item) => item.sourceRef && hqMergeRequestKey(item.sourceRef) === key)
      const merged = waiting.length > 0 ? await deps.mergedBy(event) : false
      if (merged === false) {
        continue
      }
      for (const item of waiting) {
        deps.closeWaiting(item.id, `MR !${event.iid} merged${merged ? ` by ${merged}` : ''}`)
        deps.notify('MR merged', `${item.title} — closed in Notes`)
      }
      continue
    }
    const task = await deps.getTask(event.taskRef)
    if (!task) {
      continue
    }
    const all = [...kept, ...fresh]
    if (event.kind === 'clickup-task') {
      const card = taskRequest(task, event, deps.projectForList(task.listId), now)
      if (
        !decisions[card.id] &&
        !shownTasks.has(task.id) &&
        !all.some((draft) => draft.clickupTaskId === task.id)
      ) {
        fresh.push(card)
      }
      continue
    }
    const me = await owner()
    const ordered = clickUpCommentsOldestFirst(await deps.listComments(task.id))
    const comment = ordered.find((item) => item.id === event.commentId)
    const cardId = `clickup:${task.id}:${event.commentId}`
    if (
      !comment?.author ||
      comment.author.id === me.id ||
      ignored.has(comment.author.id) ||
      ORCA_FOOTER.test(comment.body) ||
      !asksTheOwner(comment, me.username) ||
      answeredAfter(ordered, comment.id, me.id) ||
      decisions[cardId] ||
      shownIds.has(cardId) ||
      all.some((draft) => draft.id === cardId)
    ) {
      continue
    }
    fresh.push(hqClickUpRequestFrom(task, comment, deps.projectForList(task.listId), now))
  }

  // Why: an answer the owner gave in ClickUp itself retires the card, as it does for his own tasks.
  const recheck = kept.filter((draft) => draft.id.startsWith('clickup:') && draft.clickupTaskId)
  if (recheck.length > 0) {
    const me = await owner()
    const answered = new Set<string>()
    for (const draft of recheck) {
      const ordered = clickUpCommentsOldestFirst(await deps.listComments(draft.clickupTaskId ?? ''))
      if (answeredAfter(ordered, draft.id.split(':')[2] ?? '', me.id)) {
        answered.add(draft.id)
      }
    }
    kept = kept.filter((draft) => !answered.has(draft.id))
  }

  await mkdir(dir, { recursive: true })
  await writeJson(join(dir, HQ_MAIL_REQUESTS_FILE), { drafts: [...kept, ...fresh] })
  await writeJson(join(dir, HQ_MAIL_STATE_FILE), {
    lastCheckAt: now,
    seen: [...seen].slice(-SEEN_MAX)
  } satisfies MailState)
  return fresh.length
}

// Why: a merged MR and a mention should land within a couple of minutes; Gmail allows far more.
const LOOK_EVERY_MS = 2 * 60_000

/** Looks every two minutes while HQ and «New view» are on and Gmail is connected. */
export function startHqMailIntake(deps: {
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
      console.warn('[hq-mail-intake] look failed:', error instanceof Error ? error.message : error)
    } finally {
      running = false
    }
  }
  void look()
  const timer = setInterval(() => void look(), LOOK_EVERY_MS)
  return () => clearInterval(timer)
}
