// Custom build (hq-clickup-triage): the ClickUp inbox beyond comments. Every pass diffs the tasks the
// owner is on (step 0, no model), lets edits settle for half an hour, then sorts what settled in one
// small-model call (step 1): noise goes to the quiet digest, the rest becomes a request card — an
// answer it already knows only where the owner switched the triage on for the project.
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  HQ_CLICKUP_CHANGES_FILE,
  diffClickUpTask,
  mergeClickUpChange,
  parseClickUpChangesState,
  pruneClickUpSnapshots,
  snapshotOf,
  splitReadyClickUpChanges,
  type ClickUpChangeEvent,
  type ClickUpChangesState,
  type ClickUpWatchedTask
} from '../../shared/hq-clickup-changes'
import {
  HQ_CLICKUP_TRIAGE_FILE,
  HQ_TRIAGE_RULES_DIR,
  boundHqClickUpVerdict,
  hqClickUpTriagePrompt,
  parseHqClickUpVerdicts,
  type HqClickUpVerdict
} from '../../shared/hq-clickup-triage'
import { parseHqSlackQuiet, type HqSlackQuietItem } from '../../shared/hq-slack-digest'
import {
  HQ_CLICKUP_OWN_FILE,
  HQ_SLACK_SCOUT_CONFIG_FILE,
  HQ_SLACK_SCOUT_DECISIONS_FILE,
  HQ_SLACK_SCOUT_DIR,
  parseHqSlackScoutDecisions,
  parseHqSlackScoutDrafts,
  parseHqSlackScoutTuning,
  type HqSlackScoutDraft
} from '../../shared/hq-slack-scout'

const FIRST_LOOK_MS = 24 * 60 * 60_000
// Why: a task edited while the last pass ran is read again rather than missed.
const OVERLAP_MS = 60_000
const QUIET_KEEP_MS = 3 * 24 * 60 * 60_000
const OWN_COMMENTS = 8
const RULES_MAX = 6_000
// Why: one call stays small enough for the small model; the rest waits for the next pass.
const BATCH_MAX = 12

export type HqClickUpTriageDeps = {
  listUpdated: (since: number) => Promise<{ ownerId: string; tasks: ClickUpWatchedTask[] }>
  /** HQ projects with one line on each. */
  projects: () => Promise<{ slug: string; about: string }[]>
  generate: (prompt: string) => Promise<{ ok: true; text: string } | { ok: false; error: string }>
  now: () => number
}

type TriageFile = { drafts: HqSlackScoutDraft[]; items: HqSlackQuietItem[] }

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

async function writeJson(path: string, value: unknown): Promise<void> {
  const temp = `${path}.${process.pid}.tmp`
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`)
  await rename(temp, path)
}

/** Step 0: the state after this pass's diff, settling changes merged per task. */
export function applyClickUpChanges(
  state: ClickUpChangesState,
  tasks: readonly ClickUpWatchedTask[],
  ownerId: string,
  now: number
): ClickUpChangesState {
  const since = state.lastCheckAt ?? now - FIRST_LOOK_MS
  let pending = state.pending
  const snapshots = { ...state.snapshots }
  for (const task of tasks) {
    const change = diffClickUpTask(snapshots[task.id], task, ownerId, since)
    if (change.kinds.length > 0) {
      pending = mergeClickUpChange(pending, task, change, now)
    }
    snapshots[task.id] = snapshotOf(task, snapshots[task.id], now)
  }
  return {
    lastCheckAt: now - OVERLAP_MS,
    snapshots: pruneClickUpSnapshots(snapshots, now),
    pending
  }
}

function cardId(event: ClickUpChangeEvent): string {
  return `clickup-change:${event.taskId}:${event.lastAt}`
}

function cardFor(
  event: ClickUpChangeEvent,
  verdict: HqClickUpVerdict,
  now: number
): HqSlackScoutDraft {
  const review = verdict.verdict === 'review'
  return {
    id: cardId(event),
    source: 'clickup',
    clickupTaskId: event.taskId,
    kind: verdict.verdict === 'known' ? 'answer' : 'fyi',
    channelName: `ClickUp · ${event.identifier}`,
    author: '',
    permalink: event.url,
    quote: event.added.slice(0, 4_000),
    ask: (review ? `Разобрать: ${verdict.summary}` : verdict.summary).slice(0, 500),
    title: event.title.slice(0, 300) || event.identifier,
    // Why: the answer the triage knows is the draft «Just reply» starts from.
    description: verdict.verdict === 'known' ? verdict.reply : '',
    project: verdict.project,
    why: verdict.why,
    ...(review ? { needsReview: true } : {}),
    foundAt: new Date(now).toISOString()
  }
}

function quietFor(
  event: ClickUpChangeEvent,
  verdict: HqClickUpVerdict,
  now: number
): HqSlackQuietItem {
  return {
    id: cardId(event),
    author: '',
    channelName: `ClickUp · ${event.identifier}`,
    summary: verdict.summary || event.title,
    why: verdict.why,
    permalink: event.url,
    at: new Date(now).toISOString()
  }
}

async function readRules(hqPath: string, slugs: readonly string[]) {
  const rules = await Promise.all(
    slugs.map(async (slug) => ({
      slug,
      text: ((await readOptional(join(hqPath, HQ_TRIAGE_RULES_DIR, `${slug}.md`))) ?? '').slice(
        0,
        RULES_MAX
      )
    }))
  )
  return rules.filter((rule) => rule.text.trim())
}

function ownComments(text: string | null): string[] {
  try {
    const raw: unknown = JSON.parse(text ?? '{}')
    const list = raw && typeof raw === 'object' ? Reflect.get(raw, 'comments') : null
    return (Array.isArray(list) ? list : [])
      .flatMap((entry: unknown) => {
        const body = entry && typeof entry === 'object' ? Reflect.get(entry, 'text') : null
        return typeof body === 'string' ? [body.replace(/\s+/g, ' ').slice(0, 300)] : []
      })
      .slice(-OWN_COMMENTS)
  } catch {
    return []
  }
}

/** What the owner decided on each task's earlier requests, from HQ's decisions. */
function historyByTask(decisionsText: string | null, drafts: readonly HqSlackScoutDraft[]) {
  const decisions = parseHqSlackScoutDecisions(decisionsText ?? '{}')
  const history: Record<string, string[]> = {}
  for (const [id, decision] of Object.entries(decisions)) {
    const taskId = /^clickup(?:-change)?:([^:]+):/.exec(id)?.[1]
    if (taskId) {
      const day = new Date(decision.at).toISOString().slice(0, 10)
      const what = drafts.find((draft) => draft.id === id)?.ask ?? decision.title ?? ''
      ;(history[taskId] ??= []).push(`${day} ${decision.decision}: ${what}`.trim())
    }
  }
  return history
}

/** One pass; returns the request cards it raised. */
export async function runHqClickUpTriage(
  hqPath: string,
  deps: HqClickUpTriageDeps
): Promise<HqSlackScoutDraft[]> {
  const dir = join(hqPath, HQ_SLACK_SCOUT_DIR)
  const statePath = join(dir, HQ_CLICKUP_CHANGES_FILE)
  const triagePath = join(dir, HQ_CLICKUP_TRIAGE_FILE)
  const [stateText, triageText, configText, decisionsText, ownText] = await Promise.all([
    readOptional(statePath),
    readOptional(triagePath),
    readOptional(join(dir, HQ_SLACK_SCOUT_CONFIG_FILE)),
    readOptional(join(dir, HQ_SLACK_SCOUT_DECISIONS_FILE)),
    readOptional(join(dir, HQ_CLICKUP_OWN_FILE))
  ])
  const now = deps.now()
  const previous = parseClickUpChangesState(stateText)
  const { ownerId, tasks } = await deps.listUpdated(previous.lastCheckAt ?? now - FIRST_LOOK_MS)
  const state = applyClickUpChanges(previous, tasks, ownerId, now)
  const { ready, settling } = splitReadyClickUpChanges(state.pending, now)
  await mkdir(dir, { recursive: true })
  const batch = ready.slice(0, BATCH_MAX)
  if (batch.length === 0) {
    await writeJson(statePath, state)
    return []
  }
  const triage: TriageFile = {
    drafts: parseHqSlackScoutDrafts(triageText ?? '{}').drafts,
    items: parseHqSlackQuiet(triageText ?? '{}')
  }
  const enabled = new Set(parseHqSlackScoutTuning(configText ?? '').clickUpTriageProjects)
  const projects = await deps.projects()
  const prompt = hqClickUpTriagePrompt(batch, {
    projects,
    rules: await readRules(hqPath, [...enabled]),
    history: historyByTask(decisionsText, triage.drafts),
    ownComments: ownComments(ownText)
  })
  const answer = await deps.generate(prompt)
  if (!answer.ok) {
    // Why: the settled changes stay pending and go with the next pass.
    await writeJson(statePath, state)
    throw new Error(answer.error)
  }
  const verdicts = parseHqClickUpVerdicts(
    answer.text,
    batch.map((event) => event.taskId),
    projects.map((project) => project.slug)
  )
  const decisions = parseHqSlackScoutDecisions(decisionsText ?? '{}')
  const cards: HqSlackScoutDraft[] = []
  const quiet: HqSlackQuietItem[] = []
  for (const event of batch) {
    // Why: a change the model left out is still a change; the owner sees it as a note.
    const raw = verdicts.find((verdict) => verdict.taskId === event.taskId) ?? {
      taskId: event.taskId,
      project: null,
      verdict: 'info' as const,
      summary: `${event.title}: ${event.kinds.join(', ')}`,
      why: 'разбор не вернул вердикт',
      reply: ''
    }
    const verdict = boundHqClickUpVerdict(raw, enabled)
    if (verdict.verdict === 'noise') {
      quiet.push(quietFor(event, verdict, now))
    } else {
      cards.push(cardFor(event, verdict, now))
    }
  }
  const done = new Set(batch.map((event) => event.taskId))
  await writeJson(triagePath, {
    drafts: [
      ...triage.drafts.filter(
        (draft) => !decisions[draft.id] && !done.has(draft.clickupTaskId ?? '')
      ),
      ...cards
    ],
    items: [...triage.items.filter((item) => now - Date.parse(item.at) <= QUIET_KEEP_MS), ...quiet]
  })
  await writeJson(statePath, {
    ...state,
    pending: [...settling, ...ready.filter((event) => !done.has(event.taskId))]
  })
  return cards
}

// Why: the plan's pace for the small model — one batch every quarter hour.
const LOOK_EVERY_MS = 15 * 60_000

/** Runs while HQ and «New view» are on; a missing ClickUp connection just skips. */
export function startHqClickUpTriage(deps: {
  hqPath: () => string | null
  enabled: () => boolean
  run: (hqPath: string) => Promise<HqSlackScoutDraft[]>
  onAdded: (hqPath: string, cards: HqSlackScoutDraft[]) => Promise<void> | void
}): () => void {
  let running = false
  const look = async (): Promise<void> => {
    const hq = deps.hqPath()
    if (running || !hq || !deps.enabled()) {
      return
    }
    running = true
    try {
      const cards = await deps.run(hq)
      if (cards.length > 0) {
        await deps.onAdded(hq, cards)
      }
    } catch (error) {
      console.warn(
        '[hq-clickup-triage] pass failed:',
        error instanceof Error ? error.message : error
      )
    } finally {
      running = false
    }
  }
  void look()
  const timer = setInterval(() => void look(), LOOK_EVERY_MS)
  timer.unref?.()
  return () => clearInterval(timer)
}
